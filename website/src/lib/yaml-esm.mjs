// Vite 8 的 SSR module runner 会把 node_modules 里的 CommonJS 包当作 ESM 执行，
// `yaml` 因此报 `require is not defined`。这里通过 Node 的 require 加载它，
// 再以 ESM 形式转出 Astro 需要的接口。
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const YAML = nodeRequire('yaml');

export const parse = YAML.parse;
export const parseAllDocuments = YAML.parseAllDocuments;
export const parseDocument = YAML.parseDocument;
export const stringify = YAML.stringify;
export const YAMLParseError = YAML.YAMLParseError;

export default YAML;
