#!/usr/bin/env node
/**
 * Cross-repo test lock. One test run at a time across fabtraq-shared,
 * fabtraq-be, fabtraq-fe, and e2e (they can wipe/contend the same dev DB
 * and overlapping vitest/Playwright runs cause phantom timeouts).
 *
 * Usage:  node scripts/test-lock.mjs -- <command> [args...]
 *
 * Lock file: ${TMPDIR:-/tmp}/fabtraq-test.lock — holds "pid|repo|cmd|iso-time".
 * Uses `flock` (if present on PATH) for kernel-level advisory locking;
 * falls back to an O_EXCL create with stale-PID takeover otherwise.
 *
 * Set FABTRAQ_TEST_LOCK=0 to bypass entirely (e.g. CI, where runs are
 * already isolated per-job).
 *
 * This file is byte-identical across all 4 repos — copy, don't fork.
 */
import { spawnSync, spawn } from 'node:child_process';
import { openSync, writeSync, closeSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';

if (process.env.FABTRAQ_TEST_LOCK === '0') {
  run();
} else {
  main();
}

function getCommand() {
  const sep = process.argv.indexOf('--');
  const cmd = sep === -1 ? process.argv.slice(2) : process.argv.slice(sep + 1);
  if (cmd.length === 0) {
    console.error('Usage: node scripts/test-lock.mjs -- <command> [args...]');
    process.exit(2);
  }
  return cmd;
}

function run() {
  const cmd = getCommand();
  const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    process.exit(signal ? 1 : (code ?? 1));
  });
}

function shQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function main() {
  const cmd = getCommand();
  const lockPath = join(process.env.TMPDIR || tmpdir() || '/tmp', 'fabtraq-test.lock');
  const repo = basename(process.cwd());
  const cmdStr = cmd.join(' ');
  const hasFlock = spawnSync('which', ['flock']).status === 0;

  if (hasFlock) {
    runWithFlock(lockPath, repo, cmdStr, cmd);
  } else {
    runWithOExcl(lockPath, repo, cmdStr, cmd);
  }
}

function printHeld(lockPath) {
  try {
    const [pid, repo, cmd, time] = readFileSync(lockPath, 'utf8').split('|');
    console.error(`Another test run holds the lock: PID ${pid} ${repo} "${cmd}" since ${time}`);
  } catch {
    console.error('Another test run holds the lock.');
  }
}

function runWithFlock(lockPath, repo, cmdStr, cmd) {
  // Inner shell (runs only once the lock is held): write metadata, run the
  // real command, and stash its exit code in a per-invocation sentinel file.
  // flock -n itself exits 1 without ever running the shell when the lock is
  // busy, so "sentinel missing" unambiguously means "lock was busy" — no
  // confusion with the wrapped command legitimately exiting 1.
  const exitFile = join(tmpdir(), `fabtraq-test-lock-exit-${randomUUID()}`);
  const inner = [
    `printf '%s|%s|%s|%s' "$$" ${shQuote(repo)} ${shQuote(cmdStr)} "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ${shQuote(lockPath)}`,
    `${cmd.map(shQuote).join(' ')}; printf '%d' "$?" > ${shQuote(exitFile)}`,
  ].join(' && ');

  const res = spawnSync('flock', ['-n', lockPath, '-c', inner], { stdio: 'inherit' });

  if (res.error) {
    console.error(String(res.error));
    process.exit(1);
  }

  let exitCode;
  try {
    exitCode = Number(readFileSync(exitFile, 'utf8'));
    unlinkSync(exitFile);
  } catch {
    // Sentinel never got written: flock couldn't acquire the lock.
    printHeld(lockPath);
    process.exit(2);
  }
  process.exit(exitCode);
}

function runWithOExcl(lockPath, repo, cmdStr, cmd) {
  const meta = `${process.pid}|${repo}|${cmdStr}|${new Date().toISOString()}`;
  let fd;
  try {
    fd = openSync(lockPath, 'wx');
  } catch (err) {
    if (err.code === 'EEXIST') {
      const stale = isStale(lockPath);
      if (stale) {
        try {
          unlinkSync(lockPath);
        } catch {
          /* raced with someone else clearing it; fall through to retry */
        }
        try {
          fd = openSync(lockPath, 'wx');
        } catch {
          printHeld(lockPath);
          process.exit(2);
        }
      } else {
        printHeld(lockPath);
        process.exit(2);
      }
    } else {
      throw err;
    }
  }

  writeSync(fd, meta);
  closeSync(fd);

  const release = () => {
    try {
      unlinkSync(lockPath);
    } catch {
      /* already gone */
    }
  };

  const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit' });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      child.kill(sig);
    });
  }
  child.on('exit', (code, signal) => {
    release();
    process.exit(signal ? 1 : (code ?? 1));
  });
}

function isStale(lockPath) {
  try {
    const [pidStr] = readFileSync(lockPath, 'utf8').split('|');
    const pid = Number(pidStr);
    if (!pid) return true;
    process.kill(pid, 0); // throws if dead
    return false;
  } catch {
    return true; // dead PID, or unreadable/corrupt file
  }
}
