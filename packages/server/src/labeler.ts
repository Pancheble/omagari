import { matchesGlob } from "node:path";

/**
 * actions/labeler의 `.github/labeler.yml`에서 파일 조건만 읽어 파일 목록에 맞는 라벨을 고른다(ADR-0039).
 * 출처: https://github.com/actions/labeler (v5 형식). YAML 라이브러리는 들이지 않고, 이 형식에 쓰이는 꼴(맵, 목록, 글자, `[a, b]`)만 읽는다.
 * 브랜치 조건(`head-branch`, `base-branch`)은 무시하고, 파일 조건이 없는 규칙은 맞지 않는다.
 */
type Yaml = string | Yaml[] | { [key: string]: Yaml };

const unquote = (text: string) => {
  const quote = text[0];
  return (quote === '"' || quote === "'") && text.at(-1) === quote ? text.slice(1, -1) : text;
};

/** 따옴표 밖의 `#` 주석을 뗀다. */
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

/** `[a, 'b/{c,d}']` 같은 한 줄 목록을 쪼갠다. 따옴표와 중괄호 안의 쉼표는 가르지 않는다. */
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
          list.push(flow(rest)); // "- 글자"
        } else if (rest) {
          //"- key: v"는 목록 항목 안의 맵의 첫 줄이다. 글자를 뺀 자리를 그 맵의 들여쓰기로 본다.
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
      if (!found) throw new Error(`읽을 수 없는 줄: ${text}`);
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
 * 맞춰 보는 데 오래 걸릴 수 있는 글롭(길거나 `*`, `{`가 많은 것)은 어느 파일에도 맞지 않는 것으로 친다.
 * 서버 하나가 모든 멤버를 받으므로 설정 파일 하나가 서버를 붙잡지 못하게 한다.
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

/** 규칙 하나(맵)가 파일에 맞는지. 파일 조건이 하나도 없으면(브랜치 조건뿐) `undefined`로 무시한다. */
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

/** 이보다 긴 labeler.yml은 읽지 않는다(던진다). */
const MAX_LABELER_CHARS = 64 * 1024;

/** labeler.yml의 내용과 알림의 파일에 맞는 라벨 이름들. 읽을 수 없는 꼴이면 던진다. */
export const labelsFor = (source: string, files: string[]): string[] => {
  if (source.length > MAX_LABELER_CHARS) throw new Error("labeler.yml이 너무 길다");
  const config = parseYaml(source);
  if (!isMap(config)) throw new Error("labeler.yml은 라벨 이름을 키로 하는 맵이어야 한다");
  if (files.length === 0) return [];
  return Object.entries(config)
    .filter(([, rules]) => asList(rules).some((rule) => matches(rule, files) === true))
    .map(([label]) => label);
};
