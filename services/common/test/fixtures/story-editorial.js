// Invented transport story for offline contract tests; not publishable reporting.
export const storyTopic = { id: 91, title: 'Rute bus berubah selama perbaikan jembatan', url: 'https://city.example.com/rute', primary_source: 'Dishub Kota Uji', desk: 'sosial' };
export const storyInput = { version: 1, mode: 'current', facts: [
  { id: 'f1', text: 'Dinas Perhubungan Kota Uji mengalihkan rute bus menuju Terminal Jaya selama perbaikan jembatan lama.', source_url: 'https://city.example.com/rute', source_name: 'Dishub Kota Uji' },
  { id: 'f2', text: 'Operator angkutan menambah bus pada jam berangkat dan pulang sekolah untuk melayani rute pengganti.', source_url: 'https://news.example.org/bus', source_name: 'Media Kota Uji' },
  { id: 'f3', text: 'Forum Warga Kota Uji melaporkan penumpang harus berpindah kendaraan di Terminal Jaya akibat pengalihan rute.', source_url: 'https://community.example.net/bus', source_name: 'Forum Warga Kota Uji' },
  { id: 'f4', text: 'Rute pengganti menghubungkan Terminal Jaya dan kawasan sekolah; peta rute dipasang di halte dan kantor layanan.', source_url: 'https://city.example.com/rute', source_name: 'Dishub Kota Uji' },
  { id: 'f5', text: 'Petugas layanan menerima pertanyaan warga mengenai titik perpindahan dan arah perjalanan bus pengganti.', source_url: 'https://news.example.org/bus', source_name: 'Media Kota Uji' },
] };
const p = (text, ...fact_ids) => ({ text, fact_ids });

export function storyFixture() {
  return {
    format: 'carousel', mode: 'current', angle: 'Akses perjalanan selama perbaikan jembatan', scope_note: 'Informasi rute dan pengalaman warga dalam materi uji.',
    article_metadata: {
      editorial_version: 2, headline: 'Bus Beralih Rute, Terminal Jaya Jadi Titik Perpindahan',
      seo_title: 'Perubahan Rute Bus Selama Perbaikan Jembatan', meta_description: 'Rute bus dialihkan ke Terminal Jaya. Operator menambah layanan dan warga menjelaskan kebutuhan perpindahan kendaraan.',
      lead: p('Rute bus menuju kawasan sekolah dialihkan melalui Terminal Jaya selama perbaikan jembatan lama di Kota Uji. Dinas Perhubungan mengumumkan pengalihan tersebut, sedangkan operator menambah layanan pada jam perjalanan sekolah. Warga perlu memperhatikan titik perpindahan kendaraan di terminal.', 'f1', 'f2', 'f3'),
      takeaways: [p('Rute pengganti melalui Terminal Jaya selama perbaikan jembatan.', 'f1'), p('Operator menambah bus pada jam perjalanan sekolah.', 'f2'), p('Forum warga melaporkan kebutuhan berpindah kendaraan.', 'f3')],
      sections: [
        { heading: 'Terminal Jaya menjadi penghubung', paragraphs: [
          p('Pengalihan oleh Dinas Perhubungan menghubungkan Terminal Jaya dengan kawasan sekolah. Peta rute pengganti dipasang di halte dan kantor layanan. Informasi rute tersebut menjelaskan arah perjalanan yang digunakan ketika jembatan lama dalam perbaikan, sehingga titik perpindahan menjadi bagian penting dari perjalanan warga.', 'f1', 'f4'),
          p('Operator menambah bus pada jam berangkat dan pulang sekolah, sebagaimana dijelaskan Media Kota Uji. Penambahan layanan ditujukan bagi rute pengganti yang menghubungkan terminal dan kawasan sekolah. Jadwal perjalanan sekolah menjadi konteks pemilihan waktu tambahan layanan yang dijelaskan sumber angkutan.', 'f2', 'f4'),
        ] },
        { heading: 'Warga membutuhkan informasi perpindahan', paragraphs: [
          p('Forum Warga Kota Uji melaporkan bahwa penumpang harus berpindah kendaraan di Terminal Jaya akibat pengalihan. Pengalaman perpindahan itu memberi rincian perjalanan yang dihadapi warga ketika rute biasa berubah. Laporan komunitas menyoroti perjalanan penumpang, sedangkan pengumuman dinas menjelaskan lintasan pengganti.', 'f1', 'f3'),
          p('Petugas layanan menerima pertanyaan mengenai titik perpindahan dan arah bus pengganti. Peta di halte serta kantor layanan memuat rute yang digunakan selama perbaikan jembatan. Pertanyaan warga mengenai perpindahan dan arah perjalanan merupakan rincian layanan yang dicatat Media Kota Uji dalam pemberitaannya.', 'f4', 'f5'),
        ] },
      ], entities: [],
    },
    slides: [
      { no: 1, role: 'cover', purpose: 'Judul perubahan rute', claim_type: 'fact', fact_ids: ['f1'], layout: 'editorial-cover', teks: 'Terminal Jaya menjadi penghubung sementara.', data: { title: 'Bus Beralih Rute Selama Perbaikan Jembatan', kicker: 'LAYANAN WARGA' } },
      { no: 2, role: 'lead', purpose: 'Perubahan perjalanan warga', claim_type: 'fact', fact_ids: ['f1', 'f4'], layout: 'editorial-lead', teks: 'Bus melalui Terminal Jaya menuju kawasan sekolah.', data: { title: 'Lintasan Berubah', kicker: 'RUTE PENGGANTI' } },
      { no: 3, role: 'explanation', purpose: 'Rincian layanan', claim_type: 'fact', fact_ids: ['f2', 'f4', 'f5'], layout: 'editorial-breakdown', teks: 'Informasi layanan untuk warga.', data: { title: 'Titik Perjalanan', kicker: 'PANDUAN LAYANAN', items: [{ label: 'Bus tambahan', value: 'Jam sekolah' }, { label: 'Peta', value: 'Halte dan kantor' }, { label: 'Pertanyaan', value: 'Petugas layanan' }] } },
      { no: 4, role: 'public_impact', purpose: 'Pengalaman penumpang', claim_type: 'fact', fact_ids: ['f3'], layout: 'editorial-impact', teks: 'Forum warga melaporkan penumpang berganti kendaraan di Terminal Jaya.', data: { title: 'Ada Perpindahan Kendaraan', kicker: 'PENGALAMAN WARGA' } },
      { no: 5, role: 'close', purpose: 'Pertanyaan pembaca', claim_type: 'context', fact_ids: [], layout: 'editorial-close', teks: 'Bagikan pengalaman perjalananmu.', data: { title: 'Rute Mudah Dipahami?', kicker: 'RUANG PEMBACA', question: 'Informasi perjalanan apa yang kamu butuhkan?', cta: 'Simpan panduan ini' } },
    ],
    caption_blocks: [
      { kind: 'fact', ...p('Bus beralih rute, perjalanan sekolah ikut berubah.', 'f1', 'f2') },
      { kind: 'fact', ...p('Dinas Perhubungan Kota Uji mengalihkan lintasan melalui Terminal Jaya selama perbaikan jembatan. Operator menambah bus pada jam berangkat dan pulang sekolah, sedangkan forum warga melaporkan penumpang perlu berganti kendaraan di terminal.', 'f1', 'f2', 'f3') },
      { kind: 'fact', ...p('Peta rute tersedia di halte dan kantor layanan. Petugas menerima pertanyaan tentang titik perpindahan dan arah bus pengganti. Informasi perjalanan apa yang paling kamu butuhkan saat rute berubah?', 'f4', 'f5') },
    ],
    threads_body: 'Rute bus Kota Uji dialihkan melalui Terminal Jaya selama jembatan diperbaiki. Operator menambah layanan pada jam sekolah. Forum warga melaporkan penumpang harus berganti kendaraan di terminal.',
    threads_fact_ids: ['f1', 'f2', 'f3'], hashtags: ['#GapuraMedia', '#LayananPublik', '#Transportasi', '#Sosial', '#InfoWarga'],
  };
}
