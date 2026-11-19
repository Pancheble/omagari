// Definition lines and usages: reads TypeScript, TSX, and JavaScript files with tree-sitter (ADR-0026). Other languages aren't read (it returns none).
// A definition line is the line that declares a named symbol (function, method, class, type) (GLOSSARY). The body isn't a definition line.
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import type { Definition } from "@omagari/contract";
import type TreeSitter from "@vscode/tree-sitter-wasm";

type Node = TreeSitter.Node;

const GRAMMARS: Record<string, string> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
};

const wasm = dirname(createRequire(import.meta.url).resolve("@vscode/tree-sitter-wasm"));
let loaded: Promise<typeof TreeSitter> | undefined;
const languages = new Map<string, Promise<TreeSitter.Language>>();

/** Whether the file is in a language it can read. */
export const parsable = (path: string) => extname(path).toLowerCase() in GRAMMARS;

/** Reads `content` in the language of `path` and passes it to `use`. None if the language can't be read. The tree is freed right after use (wasm memory). */
async function parse<T>(path: string, content: string, use: (root: Node) => T) {
  const grammar = GRAMMARS[extname(path).toLowerCase()];
  if (!grammar) return;
  // Import the parser at the first parse, so a side that doesn't parse, like the hook, doesn't load the parser when it imports the runner.
  loaded ??= import("@vscode/tree-sitter-wasm").then(async ({ default: ts }) => {
    await ts.Parser.init();
    return ts;
  });
  const TreeSitter = await loaded;
  let language = languages.get(grammar);
  if (!language) {
    language = TreeSitter.Language.load(join(wasm, `tree-sitter-${grammar}.wasm`));
    languages.set(grammar, language);
  }
  const parser = new TreeSitter.Parser();
  try {
    parser.setLanguage(await language);
    const tree = parser.parse(content);
    if (!tree) return;
    try {
      return use(tree.rootNode);
    } finally {
      tree.delete();
    }
  } finally {
    parser.delete();
  }
}

/** A found definition. `end` is the line where the declaration ends (body included). */
type Found = Omit<Definition, "change"> & { text: string; at: number; end: number };

const FUNCTIONS = new Set([
  "function_declaration",
  "generator_function_declaration",
  "function_signature",
]);
const CLASSES = new Set(["class_declaration", "abstract_class_declaration"]);
const METHODS = new Set(["method_definition", "method_signature", "abstract_method_signature"]);
/** Cases where the whole body is the Contract: the definition line is the whole declaration. */
const STRUCTURES: Record<string, Definition["kind"]> = {
  interface_declaration: "interface",
  type_alias_declaration: "type",
  enum_declaration: "enum",
};
const VALUES = new Set(["arrow_function", "function_expression", "generator_function"]);

/** The text from `from` up to `body` (or to the end if there's no body). Whitespace is collapsed to one. */
const header = (from: Node, body: Node | null | undefined, end: Node = from) =>
  from.text
    .slice(0, (body ?? end).startIndex - from.startIndex + (body ? 0 : end.text.length))
    .replace(/\s+/g, " ")
    .trim();

/**
 * Definitions declared at the top level of the file (exports included), and the methods of those classes. A function inside a function isn't a Contract, so it's left out.
 * A variable counts as a function only if it holds a function. A method's name is `Class.method`.
 */
function declared(root: Node) {
  const found: Found[] = [];
  const add = (name: Node | null, kind: Definition["kind"], line: Node, text: string) => {
    if (name)
      found.push({
        name: name.text,
        kind,
        line: line.startPosition.row + 1,
        end: line.endPosition.row + 1,
        text,
        at: name.startIndex,
      });
  };
  for (const top of root.namedChildren) {
    if (!top) continue;
    const node = top.type === "export_statement" ? top.childForFieldName("declaration") : top;
    if (!node) continue;
    const name = node.childForFieldName("name");
    if (FUNCTIONS.has(node.type)) {
      add(name, "function", top, header(top, node.childForFieldName("body"), node));
    } else if (node.type in STRUCTURES) {
      add(name, STRUCTURES[node.type] as Definition["kind"], top, header(top, undefined, node));
    } else if (CLASSES.has(node.type)) {
      const body = node.childForFieldName("body");
      add(name, "class", top, header(top, body, node));
      for (const member of body?.namedChildren ?? []) {
        if (!member || !METHODS.has(member.type)) continue;
        const method = member.childForFieldName("name");
        if (name && method) {
          found.push({
            name: `${name.text}.${method.text}`,
            kind: "method",
            line: member.startPosition.row + 1,
            end: member.endPosition.row + 1,
            text: header(member, member.childForFieldName("body")),
            at: method.startIndex,
          });
        }
      }
    } else if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
      for (const declarator of node.namedChildren) {
        const value = declarator?.childForFieldName("value");
        if (!declarator || !value || !VALUES.has(value.type)) continue;
        const text = header(declarator, value.childForFieldName("body"));
        add(declarator.childForFieldName("name"), "function", declarator, text);
      }
    }
  }
  return found;
}

/** The file's definition lines. None if the language can't be read. */
export const definitions = (path: string, content: string) => parse(path, content, declared);

/**
 * Compares the definition lines of the base commit's version (`before`, "" if the file didn't exist) and the current version (`after`, none if the file was deleted).
 * It includes every definition that exists now. New ones are `added` and ones whose definition line changed are `changed`. A body-only change gets no mark.
 * A definition that's gone is `removed`, and its line is from the base commit's version. None if the language can't be read.
 */
export async function compare(path: string, before: string, after: string | undefined) {
  const old = await definitions(path, before);
  const now = after === undefined ? [] : await definitions(path, after);
  if (!old || !now) return;
  // Overloaded names are compared by merging all the definition lines of that one name.
  const texts = (found: Found[]) => {
    const map = new Map<string, string>();
    for (const d of found)
      map.set(`${d.kind} ${d.name}`, `${map.get(`${d.kind} ${d.name}`) ?? ""}\n${d.text}`);
    return map;
  };
  const was = texts(old);
  const is = texts(now);
  const result: Definition[] = now.map(({ name, kind, line }) => {
    const before = was.get(`${kind} ${name}`);
    const change =
      before === undefined ? "added" : before !== is.get(`${kind} ${name}`) ? "changed" : undefined;
    return { name, kind, line, ...(change && { change }) };
  });
  for (const { name, kind, line } of old) {
    if (!is.has(`${kind} ${name}`)) result.push({ name, kind, line, change: "removed" });
  }
  return result;
}

/**
 * The line range a definition of `symbol` takes up in the file (declaration and body). For overloaded names, it covers all of them.
 * None if the language can't be read or there's no definition with that name.
 */
export async function symbolRange(path: string, content: string, symbol: string) {
  const found = (await parse(path, content, declared))?.filter((d) => named(d.name, symbol));
  if (!found?.length) return;
  return {
    from: Math.min(...found.map((d) => d.line)),
    to: Math.max(...found.map((d) => d.end)),
  };
}

/** Whether the definition has the name `symbol`. A method is found by `Class.method` or by the method name alone. */
export const named = (name: string, symbol: string) =>
  name === symbol || name.endsWith(`.${symbol}`);

const IDENTIFIERS = [
  "identifier",
  "property_identifier",
  "type_identifier",
  "shorthand_property_identifier",
];

/**
 * The lines in the file that use `symbol` (for a method, the name after the `.`). It links by name only: another symbol with the same name is caught too.
 * It leaves out the place that defines that name. None if the language can't be read.
 */
export function usesIn(path: string, content: string, symbol: string) {
  const name = symbol.slice(symbol.lastIndexOf(".") + 1);
  if (!content.includes(name)) return Promise.resolve(parsable(path) ? [] : undefined);
  return parse(path, content, (root) => {
    const defined = new Set(declared(root).map((d) => d.at));
    const lines = root
      .descendantsOfType(IDENTIFIERS)
      .filter((node) => node && node.text === name && !defined.has(node.startIndex))
      .map((node) => (node as Node).startPosition.row + 1);
    return [...new Set(lines)];
  });
}
