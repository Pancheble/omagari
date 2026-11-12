// 정의 줄과 쓰는 곳: tree-sitter로 TypeScript, TSX, JavaScript 파일을 읽는다(ADR-0026). 다른 언어는 읽지 않는다(없음을 돌려준다).
// 정의 줄은 이름 붙은 심볼(함수, 메서드, 클래스, 타입)을 선언하는 줄이다(GLOSSARY). 본문은 정의 줄이 아니다.
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

/** 읽을 수 있는 언어의 파일인가. */
export const parsable = (path: string) => extname(path).toLowerCase() in GRAMMARS;

/** `path`의 언어로 `content`를 읽어 `use`에 넘긴다. 읽을 수 없는 언어면 없음이다. 나무는 쓰고 나서 바로 푼다(wasm 메모리). */
async function parse<T>(path: string, content: string, use: (root: Node) => T) {
  const grammar = GRAMMARS[extname(path).toLowerCase()];
  if (!grammar) return;
  // 훅처럼 파싱하지 않는 쪽이 러너를 가져올 때 파서를 읽지 않게, 처음 파싱할 때 가져온다.
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

type Found = Omit<Definition, "change"> & { text: string; at: number };

const FUNCTIONS = new Set([
  "function_declaration",
  "generator_function_declaration",
  "function_signature",
]);
const CLASSES = new Set(["class_declaration", "abstract_class_declaration"]);
const METHODS = new Set(["method_definition", "method_signature", "abstract_method_signature"]);
/** 몸 전체가 계약인 것: 정의 줄이 그 선언 전체다. */
const STRUCTURES: Record<string, Definition["kind"]> = {
  interface_declaration: "interface",
  type_alias_declaration: "type",
  enum_declaration: "enum",
};
const VALUES = new Set(["arrow_function", "function_expression", "generator_function"]);

/** `from`에서 `body` 앞까지(몸이 없으면 끝까지)의 글. 공백은 하나로 접는다. */
const header = (from: Node, body: Node | null | undefined, end: Node = from) =>
  from.text
    .slice(0, (body ?? end).startIndex - from.startIndex + (body ? 0 : end.text.length))
    .replace(/\s+/g, " ")
    .trim();

/**
 * 파일의 맨 위(내보낸 것 포함)에 선언된 정의와, 그 클래스의 메서드. 함수 안의 함수는 계약이 아니라 뺀다.
 * 변수는 함수를 담은 것만 함수로 본다. 메서드의 이름은 `클래스.메서드`다.
 */
function declared(root: Node) {
  const found: Found[] = [];
  const add = (name: Node | null, kind: Definition["kind"], line: Node, text: string) => {
    if (name)
      found.push({
        name: name.text,
        kind,
        line: line.startPosition.row + 1,
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

/** 파일의 정의 줄. 읽을 수 없는 언어면 없음이다. */
export const definitions = (path: string, content: string) => parse(path, content, declared);

/**
 * 기준 커밋의 판(`before`, 없던 파일이면 "")과 지금 판(`after`, 지운 파일이면 없음)의 정의 줄을 견준다.
 * 지금 있는 정의는 모두 싣고, 새로 생긴 것은 `added`, 정의 줄이 달라진 것은 `changed`다. 본문만 바뀐 것은 표시가 없다.
 * 없어진 정의는 `removed`이고 줄은 기준 커밋의 판의 것이다. 읽을 수 없는 언어면 없음이다.
 */
export async function compare(path: string, before: string, after: string | undefined) {
  const old = await definitions(path, before);
  const now = after === undefined ? [] : await definitions(path, after);
  if (!old || !now) return;
  // 겹쳐 쓴 이름(오버로드)은 한 이름의 정의 줄을 모두 합쳐 견준다.
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

/** 이름이 `symbol`인 정의인가. 메서드는 `클래스.메서드`로도 메서드 이름만으로도 찾는다. */
export const named = (name: string, symbol: string) =>
  name === symbol || name.endsWith(`.${symbol}`);

const IDENTIFIERS = [
  "identifier",
  "property_identifier",
  "type_identifier",
  "shorthand_property_identifier",
];

/**
 * 파일에서 `symbol`(메서드면 `.` 뒤의 이름)을 쓰는 줄. 이름으로만 잇는다: 같은 이름의 다른 심볼도 잡힌다.
 * 그 이름을 정의하는 자리는 뺀다. 읽을 수 없는 언어면 없음이다.
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
