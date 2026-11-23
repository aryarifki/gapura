import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEkonomiPolicy, isBursaOrOjkTopic, normalizeScoreResult, parseFastFailRules } from '../scoring.js';

test('accepts consistent in-range component scores and derives the verdict from threshold', () => {
  const result = normalizeScoreResult({ scores: { relevance: 30, credibility: 20, momentum: 15, engagement: 10, compliance: 10 }, score_total: 85, verdict: 'rejected' }, 76);
  assert.equal(result.score_total, 85);
  assert.equal(result.verdict, 'passed');
});

test('rejects out-of-range, fractional, missing, or inconsistent score values', () => {
  const base = { scores: { relevance: 30, credibility: 20, momentum: 15, engagement: 10, compliance: 10 }, score_total: 85 };
  assert.throws(() => normalizeScoreResult({ ...base, score_total: 90 }), /jumlah lima komponen/);
  assert.throws(() => normalizeScoreResult({ ...base, scores: { ...base.scores, relevance: 31 } }), /0-30/);
  assert.throws(() => normalizeScoreResult({ ...base, scores: { ...base.scores, momentum: 15.5 } }), /bilangan bulat/);
  assert.throws(() => normalizeScoreResult({ score_total: 0 }), /komponen/);
});

test('treats invalid user-entered fast-fail patterns as literal text', () => {
  const rules = parseFastFailRules('[');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].regex.test('berita ['), true);
  assert.equal(rules[0].regex.test('berita 123'), false);
});

test('validates configured component weights and derives total before a passing verdict', () => {
  const weights = { relevance: 40, credibility: 20, momentum: 20, engagement: 10, compliance: 10 };
  const value = { scores: { ...weights }, score_total: 100 };
  assert.equal(normalizeScoreResult(value, 76, weights).verdict, 'passed');
  assert.throws(() => normalizeScoreResult({ ...value, scores: { ...weights, engagement: 11 }, score_total: 101 }, 76, weights), /0-10/);
  assert.throws(() => normalizeScoreResult(value, 76, { ...weights, relevance: 41 }), /100/);
  assert.throws(() => normalizeScoreResult({ ...value, scores: { ...weights, compliance: null }, score_total: 90 }, 76, weights), /bilangan bulat/);
});

test('isBursaOrOjkTopic and checkEkonomiPolicy accept Bursa/OJK ekonomi topics and reject unrelated ekonomi topics', () => {
  const cfg = { ekonomi_requires_bursa_or_ojk: true };
  assert.equal(isBursaOrOjkTopic({ title: 'OJK Terbitkan POJK Baru Soal Transparansi Fintech', desk: 'ekonomi' }), true);
  assert.equal(isBursaOrOjkTopic({ title: 'IHSG Ditutup Menguat Usai Saham Perbankan Diborong Asing', desk: 'ekonomi' }), true);
  assert.equal(isBursaOrOjkTopic({ title: 'BEI Suspensi Saham Emiten Tambang', desk: 'ekonomi' }), true);
  assert.equal(isBursaOrOjkTopic({ title: 'Daftar Lengkap UMP 2027 Jakarta Tertinggi', desk: 'ekonomi' }), false);

  assert.equal(checkEkonomiPolicy({ title: 'OJK Perkuat Pengawasan Pasar Modal', desk: 'ekonomi' }, { desk: 'ekonomi' }, cfg).rejected, false);
  assert.equal(checkEkonomiPolicy({ title: 'Harga Cabai dan Inflasi Pangan Naik', desk: 'ekonomi' }, { desk: 'ekonomi' }, cfg).rejected, true);
  assert.equal(checkEkonomiPolicy({ title: 'Ekspor RI ke Eropa via IEU-CEPA Naik 14%', desk: 'ekonomi' }, { desk: 'ekonomi' }, cfg).rejected, true);
  assert.equal(checkEkonomiPolicy({ title: 'Rapat DPR Bahas Revisi RUU Pemilu', desk: 'politik' }, { desk: 'politik' }, cfg).rejected, false);
  assert.equal(checkEkonomiPolicy({ title: 'Harga Cabai Naik', desk: 'ekonomi' }, { desk: 'ekonomi' }, {}).rejected, false);
});
