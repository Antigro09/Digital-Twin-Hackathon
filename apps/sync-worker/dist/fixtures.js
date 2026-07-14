"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadFixtures = loadFixtures;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const yaml_1 = require("yaml");
function loadFixtures() {
    const candidates = [
        process.env.EDT_FIXTURE_ROOT,
        (0, node_path_1.resolve)(process.cwd(), 'docs/enterprise-digital-twin/fixtures/h1'),
        (0, node_path_1.resolve)(process.cwd(), '../../docs/enterprise-digital-twin/fixtures/h1'),
        (0, node_path_1.resolve)(__dirname, '../../../docs/enterprise-digital-twin/fixtures/h1'),
    ].filter((candidate) => Boolean(candidate));
    const root = candidates.find((candidate) => (0, node_fs_1.existsSync)((0, node_path_1.resolve)(candidate, 'source-fixtures.yaml')));
    if (!root)
        throw new Error(`H1 fixtures not found: ${candidates.join(', ')}`);
    return (0, yaml_1.parse)((0, node_fs_1.readFileSync)((0, node_path_1.resolve)(root, 'source-fixtures.yaml'), 'utf8'));
}
//# sourceMappingURL=fixtures.js.map