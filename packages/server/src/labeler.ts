import { matchesGlob } from "node:path";

/**
 * Reads only the file conditions from actions/labeler's `.github/labeler.yml` and picks the labels that match a list of files (ADR-0039).
 * Source: https://github.com/actions/labeler (v5 format). Brings in no YAML library; reads only the shapes this format uses (maps, lists, strings, `[a, b]`).
 * Ignores branch conditions (`head-branch`, `base-branch`), and a rule with no file conditions matches nothing.
 */
type Yaml = string | Yaml[] | { [key: string]: Yaml };

const unquote = (text: string) => {
  const quote = text[0];
  return (quote === '"' || quote === "'") && text.at(-1) === quote ? text.slice(1, -1) : text;
};

/** Strips a `#` comment outside quotes. */
const stripComment = (line: string) => {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1] ?? ""))) return line.slice(0, i);
  }
  return line;
};

/** Splits a one-line list like `[a, 'b/{c,d}']`. Commas inside quotes and braces don't split. */
const flow = (text: string): Yaml => {
  if (!text.startsWith("[") || !text.endsWith("]")) return unquote(text);
  const items: string[] = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (const c of text.slice(1, -1)) {
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "," && depth === 0) {
      items.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  if (current.trim()) items.push(current);
  return items.map((item) => unquote(item.trim()));
};

export const parseYaml = (source: string): Yaml => {
  const lines = source
    .split("\n")
    .map((raw) => stripComment(raw.replace(/\r$/, "")))
    .filter((line) => line.trim() && !line.startsWith("---"))
    .map((line) => ({ indent: line.length - line.trimStart().length, text: line.trim() }));
  let at = 0;
  const block = (indent: number): Yaml => {
    if (lines[at]?.text.startsWith("-")) {
      const list: Yaml[] = [];
      while (lines[at]?.indent === indent && lines[at]?.text.startsWith("-")) {
        const line = lines[at] as (typeof lines)[number];
        const rest = line.text.slice(1).trimStart();
        if (rest && !/^("[^"]*"|'[^']*'|[^:]+?):(\s|$)/.test(rest)) {
          at++;
          list.push(flow(rest)); // "- string"
        } else if (rest) {
          //"- key: v" is the first line of a map inside a list item. Treat the spot after the dash as that map's indentation.
          lines[at] = { indent: indent + line.text.length - rest.length, text: rest };
          list.push(block(lines[at]?.indent as number));
        } else {
          at++;
          list.push(
            lines[at] && lines[at]?.indent !== undefined ? block(lines[at]?.indent as number) : "",
          );
        }
      }
      return list;
    }
    const map: { [key: string]: Yaml } = {};
    while (lines[at] && lines[at]?.indent === indent && !lines[at]?.text.startsWith("-")) {
      const { text } = lines[at] as (typeof lines)[number];
      const found = /^("[^"]*"|'[^']*'|[^:]+?):(?:\s+([\s\S]*))?$/.exec(text);
      if (!found) throw new Error(`Can't read this line: ${text}`);
      at++;
      const key = unquote((found[1] as string).trim());
      const value = found[2]?.trim();
      const next = lines[at];
      if (value) map[key] = flow(value);
      else if (
        next &&
        (next.indent > indent || (next.indent === indent && next.text.startsWith("-")))
      )
        map[key] = block(next.indent);
      else map[key] = "";
    }
    return map;
  };
  return lines.length ? block(lines[0]?.indent as number) : {};
};

const asList = (value: Yaml | undefined): Yaml[] =>
  value === undefined || value === "" ? [] : Array.isArray(value) ? value : [value];

const isMap = (value: Yaml | undefined): value is { [key: string]: Yaml } =>
  typeof value === "object" && !Array.isArray(value);

/**
 * A glob that could take long to match (long, or with many `*` or `{`) is treated as matching no file.
 * One server takes in every member, so one config file mustn't be able to hold the server up.
 */
const tame = (glob: string) =>
  glob.length <= 200 &&
  (glob.match(/\*+/g) ?? []).length <= 6 &&
  (glob.match(/\{/g) ?? []).length <= 4;

const match = (glob: string, file: string) =>
  glob.startsWith("!")
    ? tame(glob) && !matchesGlob(file, glob.slice(1))
    : tame(glob) && matchesGlob(file, glob);

const MODES: Record<string, (globs: string[], files: string[]) => boolean> = {
  "any-glob-to-any-file": (globs, files) => globs.some((g) => files.some((f) => match(g, f))),
  "any-glob-to-all-files": (globs, files) => globs.some((g) => files.every((f) => match(g, f))),
  "all-globs-to-any-file": (globs, files) => files.some((f) => globs.every((g) => match(g, f))),
  "all-globs-to-all-files": (globs, files) => files.every((f) => globs.every((g) => match(g, f))),
};

/** Whether one rule (a map) matches a file. If it has no file conditions at all (branch conditions only), it's ignored as `undefined`. */
const matches = (rule: Yaml, files: string[]): boolean | undefined => {
  if (!isMap(rule)) return undefined;
  const checks: boolean[] = [];
  if ("changed-files" in rule)
    checks.push(
      asList(rule["changed-files"]).every((entry) =>
        isMap(entry)
          ? Object.entries(entry).every(([mode, globs]) =>
              MODES[mode]
                ? MODES[mode](
                    asList(globs).filter((g) => typeof g === "string"),
                    files,
                  )
                : false,
            )
          : false,
      ),
    );
  const inner = (list: Yaml | undefined) =>
    asList(list)
      .map((rule) => matches(rule, files))
      .filter((result) => result !== undefined);
  if ("any" in rule && inner(rule.any).length) checks.push(inner(rule.any).some(Boolean));
  if ("all" in rule && inner(rule.all).length) checks.push(inner(rule.all).every(Boolean));
  return checks.length > 0 ? checks.every(Boolean) : undefined;
};

/** A labeler.yml longer than this isn't read (it throws). */
const MAX_LABELER_CHARS = 64 * 1024;

/** The label names that match the files of an alert, from the contents of labeler.yml. Throws if the shape can't be read. */
export const labelsFor = (source: string, files: string[]): string[] => {
  if (source.length > MAX_LABELER_CHARS) throw new Error("labeler.yml is too long");
  const config = parseYaml(source);
  if (!isMap(config)) throw new Error("labeler.yml must be a map with label names as keys");
  if (files.length === 0) return [];
  return Object.entries(config)
    .filter(([, rules]) => asList(rules).some((rule) => matches(rule, files) === true))
    .map(([label]) => label);
};
