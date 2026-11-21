// Invented reporting for offline gate tests; never publish this fixture.
export const passages = [
  [
    'Dinas Perhubungan memindahkan layanan bus di koridor Pasar Utara selama pekerjaan perbaikan jalan di sekitar jalur menuju pasar.',
    'Pada 10 Oktober 2026, petugas memasang penunjuk arah di jalur pengganti dekat pintu timur pasar.',
    'Kepala Bidang Angkutan Kota Pesisir Dewi Aruna memaparkan jalur pengganti bus di sekitar Pasar Utara untuk masa pemeliharaan.',
  ],
  ['Pada 12 Oktober 2026, pengelola menyediakan 3 titik pemberhentian sementara di sekitar pasar agar penumpang tetap dapat berpindah.'],
  ['Pos informasi di pintu pasar membantu penumpang mencari jalur pengganti dan membaca petunjuk perpindahan menuju koridor lain.'],
];
export const documents = [
  { url: 'https://angkutan.example.org/pasar', name: 'Dishub Pesisir', title: 'Pengalihan bus', text: `${passages[0].join('\n')}\nBaca juga: pemberitahuan.\n${'lampiran '.repeat(1600)}Batas rahasia lampiran.` },
  { url: 'https://kota.example.net/pasar', name: 'Warta Kota', title: 'Jalur sementara', text: passages[1].join('\n') },
  { url: 'https://pesisir.example.com/pasar', name: 'Kabar Pesisir', title: 'Informasi untuk penumpang', text: passages[2].join('\n') },
];
export const brief = { version: 1, mode: 'current', discovery: { normalized_title: 'Rute bus Pasar Utara dialihkan' }, directions: {}, facts: [], slide_count: 8 };
export const synthesis = [
  { kind: 'summary', title: 'Bus Pasar Utara berpindah jalur', angle: 'Mencari jalur pengganti selama perbaikan', scope_note: 'Periode selesai pekerjaan tidak disebutkan dalam bahan.' },
  ...passages.flatMap((parts, source) => parts.map((text, index) => ({ kind: 'evidence', source_id: `d${source + 1}`, fact_id: `f${source + 1}${index + 1}`, text }))),
  { kind: 'timeline', date: '10 Oktober 2026', text: 'Petugas memasang penunjuk arah dekat pintu timur.', fact_ids: 'f12' },
  { kind: 'timeline', date: '12 Oktober 2026', text: 'Pengelola menyediakan titik pemberhentian sementara.', fact_ids: 'f21' },
  { kind: 'number', value: '3', text: 'Jumlah titik pemberhentian sementara di sekitar pasar.', fact_ids: 'f21' },
  { kind: 'person', name: 'Dewi Aruna', expansion: 'Kepala Bidang Angkutan Kota Pesisir', short: 'Kepala Bidang Angkutan', fact_ids: 'f13' },
];
export const article = [
  { kind: 'metadata', headline: 'Bus Pasar Utara Berpindah Jalur Sementara Selama Pekerjaan Perbaikan Jalan', seo_title: 'Perubahan Layanan Bus di Pasar Utara', meta_description: 'Penumpang memakai tempat pemberhentian sementara dan dapat mencari informasi menuju jalur pengganti.', fact_ids: 'f11,f21,f31' },
  { kind: 'lead', text: 'Layanan bus menuju Pasar Utara berpindah sementara selama pekerjaan perbaikan jalan. Penumpang tetap bisa menuju kawasan pasar melalui pemberhentian pengganti yang disiapkan pengelola, sementara pos informasi di pintu pasar membantu mereka mencari jalur yang tepat untuk melanjutkan perjalanan.', fact_ids: 'f11,f21,f31' },
  { kind: 'section', section: 1, text: 'Perubahan di sekitar pasar', fact_ids: 'f11' },
  { kind: 'paragraph', section: 1, text: 'Peralihan ini berawal dari pekerjaan perbaikan jalan pada jalur menuju Pasar Utara. Dinas Perhubungan memindahkan layanan bus dari koridor yang biasa digunakan agar perjalanan dapat dilanjutkan melalui pemberhentian pengganti. Kepala Bidang Angkutan Kota Pesisir Dewi Aruna memaparkan jalur tersebut untuk masa pemeliharaan.', fact_ids: 'f11,f13,f21' },
  { kind: 'paragraph', section: 1, text: 'Bagi pengguna bus yang biasanya berangkat dari koridor semula, perubahan ini berarti titik awal atau akhir perjalanan perlu disesuaikan. Yang membantu pembaca memahami perubahan ini adalah lokasi pekerjaan dan letak tempat menunggu yang diterangkan pengelola. Kedua hal itu berkaitan dengan bagian perjalanan yang sama, yaitu perpindahan dari jalan menuju pasar ke jalur bus pengganti.', fact_ids: 'f11,f21' },
  { kind: 'section', section: 2, text: 'Pemberhentian sementara' },
  { kind: 'paragraph', section: 2, text: 'Petugas memasang penunjuk arah di dekat pintu timur pasar pada 10 Oktober 2026. Pada 12 Oktober 2026, pengelola menyediakan 3 titik pemberhentian sementara di sekitar pasar. Penunjuk arah dan pemberhentian ini menjalankan fungsi yang berbeda dalam perjalanan penumpang di kawasan sekitar pasar.', fact_ids: 'f12,f21' },
  { kind: 'paragraph', section: 2, text: 'Tanda dekat pintu timur menunjukkan arah menuju jalur pengganti, sedangkan titik pemberhentian menjadi tempat berpindah tanpa kembali ke koridor lama. Penumpang dapat membaca keduanya sebagai rangkaian petunjuk: ikuti arah yang tersedia, lalu sesuaikan letak tempat menunggu dengan koridor sesudah meninggalkan pasar. Cara ini membantu ketika kebiasaan memakai pemberhentian lama tidak lagi sesuai dengan pengaturan sementara.', fact_ids: 'f12,f21' },
  { kind: 'section', section: 3, text: 'Mencari jalur dari pintu pasar' },
  { kind: 'paragraph', section: 3, text: 'Orang yang baru sampai di pasar dapat memulai dari pos informasi di pintu masuk. Di sana, mereka bisa mencari petunjuk untuk menemukan jalur pengganti dan membaca arah perpindahan menuju koridor lain. Petunjuk tersebut berguna bagi penumpang yang mengenal tujuan akhirnya tetapi belum mengetahui letak pemberhentian sementara.', fact_ids: 'f31,f21' },
  { kind: 'paragraph', section: 3, text: 'Ada perbedaan antara mengetahui bahwa rute bus berpindah dan mengetahui ke mana harus melangkah setelah berbelanja. Untuk kebutuhan kedua, pos di pintu pasar menjadi tempat praktis untuk menentukan arah sebelum memilih tempat menunggu dengan mengikuti petunjuk arah di kawasan sekitar pasar.', fact_ids: 'f31,f11' },
  { kind: 'paragraph', section: 3, text: 'Pekerjaan jalan menjelaskan alasan pemindahan, sementara petunjuk di pasar membantu orang menyesuaikan rencana perjalanan yang sudah dibuat sebelumnya. Bagi orang yang hendak berpindah ke koridor lain, perhatikan arah yang ditampilkan di pos itu sebelum memutuskan lokasi untuk menunggu bus pengganti.', fact_ids: 'f31,f11,f21' },
  { kind: 'takeaway', text: 'Bus menggunakan jalur pengganti selama pekerjaan jalan di dekat Pasar Utara.', fact_ids: 'f11' },
  { kind: 'takeaway', text: 'Penumpang bisa membaca petunjuk perpindahan dari pos informasi di pintu pasar.', fact_ids: 'f31' },
];
const slide = (no, role, layout, title, kicker, text, fact_ids, extra = {}) => ({
  kind: 'slide', no, role, layout: `editorial-${layout}`, title, kicker, text, fact_ids,
  purpose: `Menguraikan ${title.toLowerCase()}`, visual_query: `ilustrasi bus ${kicker.toLowerCase()}`, ...extra,
});
export const carousel = [
  slide(1, 'cover', 'cover', 'Bus Pasar Utara Berpindah Jalur Sementara Selama Pekerjaan Perbaikan Jalan', 'Pengalihan Bus', '', ''),
  slide(2, 'lead', 'lead', 'Koridor Pasar Berubah', 'Pekerjaan Jalan',
    'Dinas Perhubungan memindahkan layanan bus di koridor Pasar Utara selama pekerjaan perbaikan jalan. Penumpang dapat memakai 3 titik pemberhentian sementara yang disediakan pengelola, dengan penunjuk arah yang dipasang pada 10 Oktober 2026 dekat pintu timur pasar dan pos informasi untuk mencari jalur pengganti.',
    'f11,f12,f21,f31,f13'),
  { kind: 'paragraph', no: 2, text: 'Kepala Bidang Angkutan Kota Pesisir Dewi Aruna memaparkan jalur pengganti bus di sekitar Pasar Utara untuk masa pemeliharaan, sehingga penumpang dapat menyesuaikan rencana perjalanan sebelum berangkat.', fact_ids: 'f13' },
  { kind: 'paragraph', no: 2, text: 'Pada 12 Oktober 2026, pengelola menyiapkan 3 titik pemberhentian sementara di sekitar pasar, sementara pos informasi di pintu pasar membantu penumpang membaca petunjuk perpindahan menuju koridor lain.', fact_ids: 'f21,f31' },
  { kind: 'paragraph', no: 2, text: 'Petugas memasang penunjuk arah di jalur pengganti dekat pintu timur pasar pada 10 Oktober 2026, sehingga arah perpindahan dapat dibaca sejak awal.', fact_ids: 'f12' },
  slide(3, 'close', 'close', 'Bagikan Pendapat Anda', 'Ajak Berdiskusi', 'Ikuti kami dan bagikan tulisan ini ke teman Anda. Kirim kritik dan saran melalui kolom komentar.', '', { question: 'Pengalaman apa yang Anda rasakan saat jalur bus berubah?' }),
];
export const caption = [
  { kind: 'hook', text: 'Bus belum bisa berhenti di koridor yang biasa dipakai penumpang Pasar Utara.', fact_ids: 'f11' },
  { kind: 'paragraph', text: 'Selama perbaikan jalan, jalur menuju pasar berpindah sementara. Pengelola menyediakan pemberhentian lain di sekitar kawasan agar penumpang dapat melanjutkan perjalanan tanpa kembali ke jalur semula.', fact_ids: 'f11,f21' },
  { kind: 'paragraph', text: 'Dari pintu pasar, pos informasi memudahkan orang memilih lintasan yang sesuai dengan tujuan mereka, termasuk petunjuk untuk berpindah ke koridor lain.', fact_ids: 'f31' },
  { kind: 'question', text: 'Petunjuk apa yang paling Anda butuhkan ketika jalur bus berubah?' },
  ...['GapuraMedia', '#PasarUtara', '#Transportasi', '#BusKota', '#JalurSementara'].map((text) => ({ kind: 'hashtag', text })),
];
export const threads = [
  { no: 1, text: 'Perbaikan jalan mengalihkan layanan bus di sekitar Pasar Utara untuk sementara. Penunjuk arah dipasang pada 10 Oktober 2026.', fact_ids: 'f11,f12' },
  { no: 2, text: 'Kepala Bidang Angkutan Dewi Aruna memaparkan lintasan yang dipakai selama pemeliharaan.', fact_ids: 'f13' },
  { no: 3, text: 'Penumpang bisa mencari pemberhentian di sekitar pasar atau membaca petunjuk dari pintu masuk.', fact_ids: 'f21,f31' },
  { no: 4, text: 'Petunjuk arah membantu memilih koridor berikutnya. Apa yang biasanya Anda cari saat pemberhentian dipindah?', fact_ids: 'f31' },
];
export const stages = { stage1_synthesis: synthesis, stage2_article: article, stage3a_carousel: carousel,
  stage3b_caption: caption, stage3c_threads: threads, stage4_review: [{ kind: 'verdict', supported: true }] };
export const response = (stage) => JSON.stringify({ rows: stages[stage] });
export const context = {
  facts: synthesis.filter((row) => row.kind === 'evidence').map((row) => ({ id: row.fact_id, text: row.text, source_id: row.source_id })),
  entities: synthesis.filter((row) => row.kind === 'person').map(({ kind, name, expansion, short, fact_ids }) => ({ kind, name, expansion, short, fact_ids: fact_ids.split(',') })),
  documents: documents.map((doc, index) => ({ id: `d${index + 1}`, passages: passages[index] })),
};
