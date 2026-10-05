#!/usr/bin/env node

/**
 * scripts/analyze-match-decisions.js
 *
 * Parses Matching Service structured stdout logs, extracts match_decision records,
 * and calculates comparative quality/latency aggregates between matching strategies.
 *
 * Usage:
 *   node scripts/analyze-match-decisions.js <path-to-logfile>
 */

const fs = require('fs');
const readline = require('readline');
const path = require('path');

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: node scripts/analyze-match-decisions.js <logfile-path>');
  process.exit(1);
}

const resolvedPath = path.resolve(process.cwd(), filePath);
if (!fs.existsSync(resolvedPath)) {
  console.error(`Error: log file not found at ${resolvedPath}`);
  process.exit(1);
}

const fileStream = fs.createReadStream(resolvedPath, { encoding: 'utf-8' });
const rl = readline.createInterface({
  input: fileStream,
  crlfDelay: Infinity,
});

const stats = {};

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  let record;
  try {
    record = JSON.parse(trimmed);
  } catch {
    // Ignore non-JSON lines (e.g. systemd/Go standard log output)
    return;
  }

  if (!record || record.logType !== 'match_decision' || !record.strategy) {
    // Ignore unrelated JSON logs
    return;
  }

  const strategy = String(record.strategy);
  if (!stats[strategy]) {
    stats[strategy] = {
      total: 0,
      assigned: 0,
      notAssigned: 0,
      totalDistance: 0,
      totalDuration: 0,
      totalBatchSize: 0,
    };
  }

  const s = stats[strategy];
  s.total += 1;

  if (record.assigned) {
    s.assigned += 1;
    s.totalDistance += Number(record.chosenDistanceMeters) || 0;
  } else {
    s.notAssigned += 1;
  }

  s.totalDuration += Number(record.decisionDurationMs) || 0;
  s.totalBatchSize += Number(record.batchSize) || 0;
});

rl.on('close', () => {
  const strategies = Object.keys(stats);

  if (strategies.length === 0) {
    console.log('No valid match_decision log entries found in the provided file.');
    return;
  }

  console.log(
    '\n========================================================================================',
  );
  console.log(
    '                      MATCHING SERVICE A/B COMPARISON REPORT                            ',
  );
  console.log(
    '========================================================================================',
  );

  const summary = {};

  for (const strategy of strategies.sort()) {
    const s = stats[strategy];
    const successRate = s.total > 0 ? ((s.assigned / s.total) * 100).toFixed(1) + '%' : '0.0%';
    const avgDistance = s.assigned > 0 ? (s.totalDistance / s.assigned).toFixed(2) + ' m' : 'N/A';
    const avgDuration = s.total > 0 ? (s.totalDuration / s.total).toFixed(2) + ' ms' : '0.00 ms';
    const avgBatchSize =
      strategy === 'batch' && s.total > 0 ? (s.totalBatchSize / s.total).toFixed(2) : 'N/A';

    summary[strategy] = {
      'Total Decisions': s.total,
      Assigned: s.assigned,
      'Not Assigned': s.notAssigned,
      'Success Rate': successRate,
      'Avg Distance (Assigned)': avgDistance,
      'Avg Decision Duration': avgDuration,
      'Avg Batch Size': avgBatchSize,
    };
  }

  console.table(summary);
  console.log(
    '========================================================================================\n',
  );
});
