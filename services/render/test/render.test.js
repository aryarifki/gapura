// ==============================================================================
// Homeless Media Engine (HME) v2.0 - Render Engine Test Suite
// File: /root/gapura/services/render/test/render.test.js
// Tests all 9 layout templates and measures performance & image dimensions
// ==============================================================================

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { RenderEngine } from '../engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DESIGN_SYSTEM_PATH = path.resolve(__dirname, '../../../design-system');
const OUTPUT_TEST_DIR = path.resolve(__dirname, '../../../storage/test_output');

const sampleSlides = [
  {
    no: 1,
    layout: 'cover-stat',
    teks: 'Inflasi Tahunan Turun ke 2,12%',
    data: { value: '2,12%', unit: 'YoY · AGUSTUS 2026', title: 'Inflasi Tahunan Indonesia Terkendali', category: 'EKONOMI MAKRO' },
    source: 'Badan Pusat Statistik (BPS)',
  },
  {
    no: 2,
    layout: 'big-statement',
    teks: 'Kondisi moneter nasional tetap berdaya tahan kuat di tengah ketidakpastian pasar keuangan global.',
    data: { author: 'Gubernur Bank Indonesia', category: 'MONETER' },
    source: 'Rapat Dewan Gubernur BI',
  },
  {
    no: 3,
    layout: 'stat-grid',
    teks: 'Indikator Utama Pasar Modal',
    data: {
      items: [
        { label: 'IHSG Penutupan', value: '7.854' },
        { label: 'Net Buy Asing', value: 'Rp 1,2 T' },
        { label: 'Nilai Transaksi', value: 'Rp 14,8 T' },
        { label: 'Kapitalisasi Pasar', value: 'Rp 13.400 T' },
      ],
      category: 'BURSA SAHAM',
    },
    source: 'Bursa Efek Indonesia (IDX)',
  },
  {
    no: 4,
    layout: 'chart-bar',
    teks: 'Top Sektor Penggerak IHSG Hari Ini',
    data: {
      labels: ['Keuangan', 'Infrastruktur', 'Energi', 'Konsumer', 'Teknologi'],
      values: [2.4, 1.8, 1.2, 0.7, -0.4],
      category: 'BURSA SAHAM',
    },
    source: 'IDX Market Summary',
  },
  {
    no: 5,
    layout: 'chart-line',
    teks: 'Tren BI-Rate 6 Bulan Terakhir',
    data: {
      labels: ['Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep'],
      values: [6.25, 6.25, 6.25, 6.25, 6.00, 6.00],
      category: 'KEBIJAKAN MONETER',
    },
    source: 'Bank Indonesia (BI)',
  },
  {
    no: 6,
    layout: 'regulasi',
    teks: 'Pasal 14 ayat (1): Setiap perusahaan terbuka wajib menyampaikan laporan keuangan auditan paling lambat akhir bulan ketiga setelah tanggal laporan keuangan tahunan.',
    data: { title: 'POJK NO. 14/POJK.04/2026 TENTANG KETERBUKAAN INFORMASI' },
    source: 'JDIH Otoritas Jasa Keuangan',
  },
  {
    no: 7,
    layout: 'timeline',
    teks: 'Kronologi Implementasi Peraturan Bursa Baru',
    data: {
      events: [
        { date: '15 Jan 2026', text: 'Penerbitan draf publik aturan transparansi transaksi bursa.' },
        { date: '01 Mar 2026', text: 'Uji coba sistem pelaporan terpadu bersama anggota bursa.' },
        { date: '15 Jul 2026', text: 'Penyesuaian batas auto-rejection simetris tahap pertama.' },
        { date: '01 Okt 2026', text: 'Pemberlakuan penuh regulasi di seluruh papan perdagangan.' },
      ],
      category: 'REGULASI BURSA',
    },
    source: 'Siaran Pers Bersama IDX & OJK',
  },
  {
    no: 8,
    layout: 'comparison',
    teks: 'Skema Transaksi Negosiasi: Sebelum vs Sesudah Aturan Baru',
    data: {
      left: { title: 'Ketentuan Lama', text: 'Pelaporan transaksi negosiasi diperkenankan dalam waktu 24 jam setelah kesepakatan.' },
      right: { title: 'Ketentuan Baru', text: 'Wajib dilaporkan secara real-time maksimal 15 menit melalui platform terintegrasi.' },
      category: 'HUKUM & BURSA',
    },
    source: 'Lampiran Keputusan Direksi BEI',
  },
  {
    no: 9,
    layout: 'cta-close',
    teks: 'Bagaimana dampak aturan baru ini terhadap efisiensi dan likuiditas portofoliomu?',
    data: {
      cta: 'Simpan postingan ini & ikuti @homelessmedia untuk data harian.',
      disclaimer: 'Informasi ini disajikan untuk edukasi data dan bukan merupakan rekomendasi investasi keuangan.',
    },
    source: '@homelessmedia',
  },
];

async function runTest() {
  console.log('--- Memulai Uji Coba Render Engine HME v2.0 ---');
  const engine = new RenderEngine(DESIGN_SYSTEM_PATH);

  const startTotal = Date.now();
  const results = await engine.renderCarouselToDisk('test_9_layouts', sampleSlides, OUTPUT_TEST_DIR);
  const totalTime = Date.now() - startTotal;

  console.log(`\nBerhasil merender ${results.length} slide dalam ${totalTime} ms (Rata-rata: ${Math.round(totalTime / results.length)} ms/slide):`);

  for (const res of results) {
    const metadata = await sharp(res.file_path).metadata();
    console.log(`[PASS] Slide #${res.slide_no} [${res.layout}]: ${metadata.width}x${metadata.height}px (${res.render_time_ms} ms) -> ${path.basename(res.file_path)}`);
    if (metadata.width !== 1080 || metadata.height !== 1350) {
      throw new Error(`Dimensi tidak valid pada slide ${res.slide_no}: ${metadata.width}x${metadata.height}`);
    }
  }

  console.log('\n--- SEMUA 9 TEMPLATE LAYOUT TERUJI & LULUS VERIFIKASI (1080x1350 4:5 Feed) ---');
}

runTest().catch((err) => {
  console.error('[FAIL] Test gagal:', err);
  process.exit(1);
});
