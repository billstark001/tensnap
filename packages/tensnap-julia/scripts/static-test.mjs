import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname;
const source = readFileSync(join(root, 'src', 'TenSnap.jl'), 'utf8');
const project = readFileSync(join(root, 'Project.toml'), 'utf8');
const tests = readFileSync(join(root, 'test', 'runtests.jl'), 'utf8');
const dynamics = readFileSync(join(root, '..', '..', 'examples', 'julia', 'el_farol.jl'), 'utf8');
const viz = readFileSync(join(root, '..', '..', 'examples', 'julia', 'el_farol_viz.jl'), 'utf8');

assert.match(project, /^version = "0\.2\.0"$/m, 'Julia Project.toml should use version 0.2.0');
assert.match(source, /const ACTION_START = "start"/, 'start action id must match protocol and agent CLI');
assert.match(source, /const ACTION_STEP = "step"/, 'step action id must match protocol and agent CLI');
assert.match(source, /const ACTION_RESET = "reset"/, 'reset action id must match protocol and agent CLI');
assert.doesNotMatch(source, /__tensnap_/, 'internal lifecycle action ids must not leak onto the wire');
assert.match(source, /"items" => items/, 'full layer payloads should use protocol items field');
assert.match(source, /"items" => creates/, 'incremental create payloads should use protocol items field');
assert.match(source, /"items" => updates/, 'incremental update payloads should use protocol items field');
assert.match(source, /"items" => deletes/, 'incremental delete payloads should use protocol items field');
assert.doesNotMatch(source, /"agents" => _layer_items|"edges" => _layer_items/, 'wire payloads should not use legacy agents/edges item aliases');
assert.match(source, /_call0or1\(c\.getter, s\.model\)/, 'chart getters should support zero-arg and model-aware forms');
assert.match(source, /_call0or1\(s\.actions\[id\]\.handler, s\.model\)/, 'action handlers should support zero-arg and model-aware forms');
assert.match(source, /function _layer_item_deltas!/, 'Julia binding should implement incremental layer diffing');
assert.match(source, /function publish_asset!/, 'Julia binding should implement asset publishing');
assert.match(source, /function remove_environment!/, 'Julia binding should expose environment delete helpers');
assert.match(source, /function remove_layer!/, 'Julia binding should expose layer delete helpers');
assert.match(source, /"asset_sync"/, 'Julia binding should handle renderer asset sync requests');
assert.match(source, /function request_screenshot!/, 'Julia binding should implement screenshot requests');
assert.match(source, /"screenshot_response"/, 'Julia binding should handle screenshot responses');
assert.doesNotMatch(dynamics, /using TenSnap/, 'pure El Farol dynamics must not depend on TenSnap');
assert.match(viz, /include\("el_farol\.jl"\)/, 'El Farol visualization should include pure dynamics');
assert.match(tests, /@testset "scenario builders and lifecycle"/, 'Julia runtests should cover scenario lifecycle');
assert.match(tests, /@testset "incremental layer diffing"/, 'Julia runtests should cover incremental diffing');
assert.match(tests, /@testset "asset cache"/, 'Julia runtests should cover asset cache helpers');
assert.match(tests, /@testset "fine-grained CRD helpers"/, 'Julia runtests should cover fine-grained CRD helpers');
assert.match(tests, /@testset "El Farol dynamics stay TenSnap-free"/, 'Julia runtests should cover split El Farol dynamics');

console.log('TenSnap.jl static checks passed');
