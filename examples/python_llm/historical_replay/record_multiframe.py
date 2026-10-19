"""One continuous native multi-frame recording per original experiment.

Only Naming 24/25/28 and Commons 208/209 are exported as fixed frames. Exact
checkpoints at 24/208 are captured at those original boundaries for restoration.
No collection stores, per-tick export loop, or live provider are used.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

import msgpack

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
CLI = ['node', str(REPO / 'packages/tensnap-agent/dist/cli.js')]
PYTHON = sys.executable
ENV = {k: v for k, v in os.environ.items() if not (
    k.startswith(('LLM_', 'DEEPSEEK_', 'OPENAI_')) or k == 'API_SECRET')}
ENV.update(PYTHONPATH=str(REPO), PYTHONDONTWRITEBYTECODE='1', PYTHONUNBUFFERED='1')


def write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def decoded(capture):
    checkpoint = capture['checkpoint']
    data = checkpoint['data']
    raw = base64.b64decode(data.split(',')[-1]) if isinstance(data, str) else bytes(data)
    return msgpack.unpackb(raw, raw=False)


def monitor_value(response):
    return response['items'][0]['value']['value']


class Recording:
    def __init__(self, name, spec, output, port):
        self.name, self.spec, self.output, self.port = name, spec, output, port
        self.folder = output / name
        self.folder.mkdir()
        self.flags = ['--context', 'multi-' + name, '--context-dir', str(output / 'runtime')]
        self.server = None
        self.checks = []
        self.command_count = 0
        write(self.folder / 'spec.json', spec)

    def cli(self, args, online=True, expected=0):
        argv = [*CLI, *map(str, args), *(self.flags if online else []), '--output-version', '1']
        started = time.monotonic()
        process = subprocess.run(argv, cwd=REPO, env=ENV, text=True,
                                 capture_output=True, timeout=140)
        row = {'argv': argv, 'exitCode': process.returncode, 'stdout': process.stdout,
               'stderr': process.stderr, 'elapsedMs': round((time.monotonic() - started) * 1000, 2)}
        with (self.folder / 'commands.jsonl').open('a') as stream:
            stream.write(json.dumps(row, ensure_ascii=False) + '\n')
        self.command_count += 1
        assert process.returncode == expected, row
        response = json.loads(process.stdout)
        assert response['schemaVersion'] == 1 and response['ok'] == (expected == 0)
        return response['data'] if expected == 0 else response

    def check(self, name, passed, detail=None):
        self.checks.append({'name': name, 'passed': bool(passed), 'detail': detail})
        write(self.folder / 'checks.json', self.checks)
        assert passed, self.checks[-1]
        print(self.name, name, 'PASS', flush=True)

    def start(self):
        log = (self.folder / 'backend.log').open('w')
        self.server = subprocess.Popen([PYTHON, '-B', str(ROOT / 'serve_replay.py'),
                                       str(self.folder / 'spec.json'), '--port', str(self.port)],
                                      cwd=REPO, env=ENV, stdout=log, stderr=log)
        log.close()
        for _ in range(100):
            assert self.server.poll() is None, (self.folder / 'backend.log').read_text()
            if 'OFFLINE READY' in (self.folder / 'backend.log').read_text():
                break
            time.sleep(.05)
        self.cli(['runtime', 'up', '--simulator-url', f'ws://127.0.0.1:{self.port}',
                  '--client-message-validation', 'error', '--server-message-validation', 'error',
                  '--background-color', '#ffffff'])
        self.cli(['scene', 'inspect'])

    def capture(self, filename):
        path = self.folder / filename
        self.cli(['scene', 'capture', '--output', path])
        return json.loads(path.read_text())

    def advance(self, count):
        if count == 0:
            return
        run = self.cli(['run', 'start', 'start', '--max-actions', count, '--wait',
                        '--timeout-ms', '120000'])['run']
        assert run['succeededActions'] == count and run['failedActions'] == 0
        assert run['settled'] and run['stateKnown']

    def record(self):
        self.cli(['recording', 'start', '--max-frames', '10000', '--max-bytes', '67108864',
                  '--retention', 'bounded', '--label', 'Original trajectory, offline tape replay'])
        tick = 0
        pair = (24, 25) if self.name == 'naming' else (208, 209) if self.name == 'commons-legal' else None
        chart = 'names' if self.spec['example'].endswith('naming_game') else 'resource'
        if pair:
            before, after = pair
            self.advance(before)
            tick = before
            saved = self.folder / 'keyframes' / f'tick-{before:04d}'
            self.cli(['frame', 'save', '--checkpoint', 'required', '--env', 'main', '--chart', chart,
                      '--background-color', '#ffffff', '--output', saved])
            self.advance(after - tick)
            tick = after
            self.reference = self.capture('continuation-reference.json')
            self.reference_chart = self.cli(['chart', 'list'])
        self.advance(self.spec['target_tick'] - tick)
        before_failure = self.capture('final-checkpoint.json')
        if self.spec.get('expected_error'):
            self.cli(['run', 'start', 'start', '--max-actions', '1', '--wait'], expected=3)
            run = self.cli(['run', 'status'])['run']
            after_failure = self.capture('after-rejection-checkpoint.json')
            self.check('original-failure-with-unchanged-checkpoint',
                       run['failedActions'] == 1 and run['succeededActions'] == 0 and
                       run['settled'] and run['stateKnown'] and run['stopReason'] == 'action-error' and
                       run['lastAction']['timeBefore'] == run['lastAction']['timeAfter'] == self.spec['target_tick'] and
                       before_failure['checkpoint'] == after_failure['checkpoint'])
        self.cli(['recording', 'stop'])
        catalog = self.cli(['recording', 'list'])['recordings']
        self.check('one-continuous-multi-frame-recording', len(catalog) == 1 and catalog[0]['status'] == 'persisted')
        self.file = self.folder / 'full.tensnap-recording.json'
        self.cli(['recording', 'export', catalog[0]['id'], '--output', self.file])
        actual = decoded(before_failure)
        original = json.loads((Path(self.spec['source']) / 'result.json').read_text())['runs'][0]
        self.check('original-final-checkpoint-matches', actual['model'] == original['checkpoint'])
        inference = monitor_value(self.cli(['monitor', 'get', 'inference']))
        self.check('zero-live-LLM-calls', inference.get('live_calls', 0) == 0 and
                   inference['mode'] == ('replay' if self.spec.get('tape') else 'rule'), inference)
        if pair:
            restored = self.cli(['frame', 'restore', saved, '--mode', 'checkpoint', '--history', 'replace'])
            self.check('selected-checkpoint-and-chart-history-restored',
                       restored['modelStatus'] == 'restored' and restored['historyStatus'] == 'restored' and restored['stateKnown'])
            self.cli(['action', 'run', 'step', '--wait'])
            rerun = self.capture('continuation-rerun.json')
            self.check('selected-continuation-model-and-chart-match',
                       decoded(rerun) == decoded(self.reference) and self.cli(['chart', 'list']) == self.reference_chart)

    def stop(self):
        try:
            self.cli(['runtime', 'down'])
        finally:
            if self.server and self.server.poll() is None:
                self.server.terminate()
                self.server.wait(timeout=10)

    def offline(self):
        info = self.cli(['recording', 'info', self.file], online=False)
        self.check('full-multi-frame-resource-complete',
                   info['frameCount'] >= self.spec['target_tick'] and not info['truncated'] and
                   info['resourcesComplete'] and not info['legacy'], info)
        self.cli(['recording', 'seek', self.file, '--time', '0', '--match', 'first'], online=False)
        self.cli(['recording', 'seek', self.file, '--time', self.spec['target_tick'], '--match', 'last'], online=False)
        history = self.cli(['recording', 'monitor-history', self.file, 'metrics',
                            '--from', info['firstFrame'], '--to', info['lastFrame'],
                            '--sampling', 'changes', '--limit', '1000'], online=False)
        assert not history['truncated'] and not history['gaps']
        actual = {monitor_value(sample)['tick']: monitor_value(sample) for sample in history['samples']}
        source = Path(self.spec['source'])
        original = json.loads((source / 'result.json').read_text())['runs'][0]
        expected = {r['tick']: r for r in original['series']}
        self.check('all-original-metric-boundaries-match', actual == expected, {'boundaries': len(expected)})
        ticks = [25, 28] if self.name == 'naming' else [209] if self.name == 'commons-legal' else []
        chart = 'names' if self.name == 'naming' else 'resource'
        for tick in ticks:
            self.cli(['recording', 'export-frame', self.file, '--time', tick, '--match', 'last',
                      '--env', 'main', '--chart', chart, '--background-color', '#ffffff',
                      '--output', self.folder / 'keyframes' / f'tick-{tick:04d}'], online=False)
        if ticks:
            self.cli(['recording', 'render', self.file, '--time', self.spec['target_tick'], '--match', 'last',
                      '--env', 'main', '--background-color', '#ffffff', '--output', self.folder / 'final.png'], online=False)
        write(self.folder / 'result.json', {'case': self.name, 'passed': True,
              'successfulOriginalActions': self.spec['target_tick'], 'liveLLMCalls': 0,
              'singleContinuousRecording': True, 'recordingInfo': info,
              'metricBoundaries': len(actual), 'checksPassed': len(self.checks), 'cliCommands': self.command_count})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cases', nargs='+')
    parser.add_argument('--port', type=int, default=8895)
    args = parser.parse_args()
    specs = json.loads((ROOT / 'multiframe-inputs.json').read_text())
    args.output.mkdir(exist_ok=True)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', args.port))
    for name in args.cases or specs:
        case = Recording(name, specs[name], args.output, args.port)
        try:
            case.start()
            case.record()
        finally:
            case.stop()
        case.offline()
        print(name, 'COMPLETE', flush=True)


if __name__ == '__main__':
    main()
