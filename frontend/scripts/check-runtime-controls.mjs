import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const terminal = read('src/components/runtime-workbench/terminal-workbench.tsx');
assert.doesNotMatch(terminal, /scheduleReconnect|reconnectTimerRef|MAX_RECONNECTS/, 'terminal must not schedule automatic reconnect');
assert.match(terminal, /shouldConnectTerminal\(isAutoReconnect\)/, 'connection entry must reject automatic reconnect');
assert.match(terminal, /不会重放已输入命令/, 'lost-shell warning must explain command safety');
const logs = read('src/components/runtime-workbench/logs-workbench.tsx');
assert.match(logs, /aria-label="实时接收日志"/, 'stream receiving needs its own control');
assert.match(logs, /aria-label="跟随日志滚动"/, 'scroll following needs its own control');
assert.match(logs, /terminal\.onScroll/, 'user scroll must update following state');
assert.match(logs, /条新日志 · 回到底部/, 'history reader must see unread output');
assert.doesNotMatch(logs, /\[rawLines, severity, renderOptions, replayToTerminal\]/, 'incoming log batches must not replay entire scrollback');
console.log('[check-runtime-controls] PASS: manual terminal reconnect and independent log controls.');
