// SYNTHETIC: hand-authored response corpus for tests, never published facts or
// captured model output. All institutions, case details and event dates are
// invented. example.org URLs are reference placeholders and are never fetched.
// This helper supplies only the wire shape; each desk's prose is authored below.
const slide = (no, role, purpose, teks, fields = {}) => ({
  no, role, purpose, claim_type: 'context', fact_ids: [],
  layout: no === 1 ? 'cover-focus' : 'big-statement', teks,
  data: no === 1 ? { title: teks } : {}, ...fields,
});

export const SIX_DESK_CORPUS = [
  {
    desk: 'politik',
    topic: {
      id: 601, desk: 'politik',
      title: 'SYNTHETIC: DPRD membahas usulan anggaran layanan warga',
      primary_source: 'Redaksi Politik SYNTHETIC',
      url: 'https://example.org/synthetic/politik/usulan-anggaran',
    },
    editorialInput: { version: 1, mode: 'explainer', facts: [] },
    raw: {
      format: 'carousel', mode: 'explainer',
      angle: 'Menelusuri hubungan usulan warga, kewenangan anggaran, dan alasan pemilihan prioritas',
      scope_note: 'SYNTHETIC: penjelasan umum tentang partisipasi anggaran dari judul latihan; tanpa klaim tentang rapat atau keputusan lembaga nyata.',
      slides: [
        slide(1, 'cover', 'Membuka pertanyaan tentang kuasa atas prioritas', 'Usulan warga masuk rapat, lalu siapa yang menentukan prioritas?'),
        slide(2, 'lead', 'Membedakan forum aspirasi dari kewenangan anggaran', 'Forum aspirasi memberi ruang bagi usulan warga. Agar usulan dapat menjadi layanan, pembahasannya perlu terhubung dengan kewenangan anggaran, tanggung jawab pelaksana, dan pilihan prioritas yang bisa dijelaskan.'),
        slide(3, 'explanation', 'Membandingkan mandat perwakilan dan mandat pelaksanaan', 'Perwakilan dan pelaksana punya pertanyaan pertanggungjawaban yang berbeda. Pembaca dapat menelusuri siapa yang membawa aspirasi dan siapa yang memiliki tugas menjalankan layanan.', {
          layout: 'comparison',
          data: {
            left: { title: 'Mandat perwakilan', text: 'Bagaimana aspirasi warga dibawa ke pembahasan anggaran?' },
            right: { title: 'Mandat pelaksanaan', text: 'Bagaimana tugas, sumber daya, dan penanggung jawab layanan dijelaskan?' },
          },
        }),
        slide(4, 'explanation', 'Menjadikan risalah sebagai jejak alasan', 'Risalah yang memuat alasan pemilihan prioritas dapat membantu warga membaca proses politik. Daftar peserta rapat saja tidak cukup untuk memahami usulan mana yang dibahas, pertimbangan yang dipakai, serta ruang keberatan yang tersedia.'),
        slide(5, 'public_impact', 'Menguji keterwakilan kebutuhan yang sulit hadir di forum', 'Jika partisipasi bergantung pada kehadiran di forum, pekerja dengan jam kaku atau warga dengan kebutuhan akses khusus bisa kesulitan menyampaikan usulan. Saluran tertulis dan pendampingan dapat menjadi bagian dari desain keterwakilan.'),
        slide(6, 'close', 'Memberi pertanyaan tindak lanjut yang dapat diajukan warga', 'Saat membaca agenda anggaran, tanyakan jalur usulan, alasan prioritas, dan pihak yang bertanggung jawab. Jawaban yang bisa ditelusuri memberi pegangan untuk menilai hubungan antara mandat politik dan kebutuhan layanan.'),
      ],
      caption_blocks: [
        'SYNTHETIC, latihan editorial: pembahasan anggaran dapat dibaca sebagai proses memilih kebutuhan yang memperoleh perhatian publik. Usulan warga memberi bahan bagi perdebatan, sedangkan kemampuan menjelaskan alasan prioritas memberi dasar untuk menilai pertanggungjawaban politik.',
        'Pisahkan forum penyampaian aspirasi dari kewenangan menggunakan anggaran. Warga dapat menanyakan ke mana usulan diteruskan, siapa yang membahasnya, dan tugas pelaksana layanan. Kehadiran dalam rapat tidak dengan sendirinya menjelaskan hubungan antara aspirasi, pilihan program, dan tanggung jawab kerja.',
        'Jejak proses juga penting. Risalah yang menjelaskan alasan penerimaan atau penundaan usulan dapat membantu pembaca memeriksa konsistensi argumen. Tanpa uraian pertimbangan, daftar agenda dan dokumentasi pertemuan hanya memberi gambaran kegiatan, sementara alasan prioritas tetap sulit dipahami.',
        'Keterwakilan perlu dibaca dari akses terhadap forum. Jika waktu pertemuan atau syarat kehadiran membatasi partisipasi, saluran tertulis dan dukungan akses dapat menjadi pilihan. Pertanyaannya ialah bagaimana kebutuhan warga yang sulit hadir tetap masuk ke bahan pembahasan tanpa diwakili secara serampangan.',
        'Pegangan pembaca adalah jalur aspirasi yang jelas, alasan pilihan yang terbuka, serta penanggung jawab yang dapat dihubungi. Penjelasan umum ini tidak menilai rapat tertentu. Ia menawarkan cara menghubungkan mandat perwakilan dengan pelaksanaan layanan melalui pertanyaan yang bisa dijawab secara konkret.',
      ].map((text) => ({ kind: 'context', text, fact_ids: [] })),
      threads_body: 'SYNTHETIC: usulan anggaran perlu ditelusuri dari forum aspirasi ke alasan prioritas dan tanggung jawab pelaksana. Tanyakan siapa yang membawa kebutuhan warga, bagaimana pertimbangannya dijelaskan, serta saluran bagi warga yang sulit hadir. Ini penjelasan umum tentang mandat politik.',
      threads_fact_ids: [], hashtags: ['#GapuraMedia', '#Politik', '#AnggaranPublik'],
    },
  },
  {
    desk: 'sosial',
    topic: {
      id: 602, desk: 'sosial',
      title: 'SYNTHETIC: Akses sekolah dan layanan pendaftaran bagi anak',
      primary_source: 'Redaksi Sosial SYNTHETIC',
      url: 'https://example.org/synthetic/sosial/akses-sekolah',
    },
    editorialInput: { version: 1, mode: 'explainer', facts: [] },
    raw: {
      format: 'carousel', mode: 'explainer',
      angle: 'Membaca akses sekolah melalui beban waktu, kejelasan pendaftaran, dan dukungan bagi keluarga',
      scope_note: 'SYNTHETIC: uraian konseptual tentang akses pendidikan; tidak menyatakan adanya kebijakan penerimaan atau pengalaman keluarga tertentu.',
      slides: [
        slide(1, 'cover', 'Menggeser perhatian dari bangku kelas ke pintu masuk layanan', 'Akses sekolah dimulai sebelum anak duduk di kelas'),
        slide(2, 'lead', 'Memetakan rangkaian pekerjaan keluarga saat pendaftaran', 'Mencari petunjuk, menyiapkan dokumen, dan menjangkau tempat pendaftaran merupakan bagian dari akses sekolah. Jika petunjuk sulit dipahami, keluarga dapat membutuhkan waktu tambahan sebelum anak memperoleh kesempatan belajar.'),
        slide(3, 'explanation', 'Menjelaskan biaya waktu yang tidak tampak dalam syarat', 'Layanan yang tampak sederhana di atas kertas bisa menuntut perjalanan, izin kerja, atau bantuan membaca formulir. Beban waktu ini perlu masuk ke pembahasan akses, terutama jika keluarga harus mengulang kunjungan karena petunjuk kurang jelas.'),
        slide(4, 'explanation', 'Membedakan syarat administratif dari bantuan mengaksesnya', 'Syarat pendaftaran dan dukungan pendampingan memiliki fungsi yang berbeda. Penjelasan keduanya dapat membantu keluarga memahami apa yang diminta serta bagaimana meminta bantuan tanpa membuka data pribadi secara berlebihan.', {
          layout: 'comparison',
          data: {
            left: { title: 'Syarat administratif', text: 'Dokumen dan prosedur apa yang perlu dipahami keluarga?' },
            right: { title: 'Dukungan pendampingan', text: 'Bagaimana keluarga dapat memperoleh penjelasan yang mudah diakses?' },
          },
        }),
        slide(5, 'public_impact', 'Menempatkan kebutuhan disabilitas dalam pengalaman layanan', 'Petunjuk yang bisa dibaca alat bantu, ruang layanan yang mudah dijangkau, dan komunikasi yang ramah dapat membantu calon peserta didik dengan disabilitas. Akses perlu dilihat dari pengalaman menggunakan layanan, bukan sekadar ketersediaan formulir.', { layout: 'illustration' }),
        slide(6, 'close', 'Menawarkan ukuran akses yang melampaui status terdaftar', 'Pertanyaan tentang akses sekolah perlu mencakup kejelasan petunjuk, beban perjalanan, dan jalur bantuan. Status terdaftar belum menjawab apakah keluarga dapat menavigasi layanan dengan aman serta anak memperoleh dukungan belajar yang sesuai.'),
      ],
      caption_blocks: [
        'SYNTHETIC, latihan editorial: akses sekolah mencakup perjalanan keluarga sebelum kegiatan belajar dimulai. Informasi pendaftaran, persiapan dokumen, dan cara meminta bantuan dapat membentuk pengalaman itu. Pembahasan akses perlu memberi tempat bagi pekerjaan yang sering tidak terlihat di dalam formulir.',
        'Perhatikan beban waktu. Keluarga dapat membutuhkan izin kerja, perjalanan, atau bantuan memahami petunjuk. Jika syarat berubah antarpenjelasan atau sulit ditemukan, kunjungan berulang bisa menyulitkan pengasuhan dan pekerjaan. Ini alasan untuk menilai kejelasan prosedur sebagai bagian dari mutu layanan.',
        'Syarat administratif perlu dibedakan dari dukungan pendampingan. Dokumen menjelaskan apa yang diminta, sedangkan pendampingan membantu keluarga memahami langkah yang tersedia. Jalur bantuan sebaiknya mudah dikenali dan menjaga privasi, sehingga keluarga tidak perlu membagikan informasi anak ke saluran sembarang.',
        'Kebutuhan disabilitas juga menyangkut pengalaman menggunakan layanan. Petunjuk yang dapat dibaca alat bantu, ruang yang mudah dijangkau, serta pilihan komunikasi yang sesuai dapat memperluas akses. Ketersediaan pendaftaran daring saja belum menjawab apakah seluruh calon peserta didik bisa menggunakannya.',
        'Karena itu, tanyakan bagaimana petunjuk disampaikan, bantuan diperoleh, dan hambatan keluarga ditangani. Status terdaftar adalah bagian dari proses, sementara keberlanjutan dukungan belajar tetap perlu diperhatikan. Uraian ini membahas mekanisme akses secara umum tanpa mengklaim pengalaman sekolah atau keluarga nyata.',
      ].map((text) => ({ kind: 'context', text, fact_ids: [] })),
      threads_body: 'SYNTHETIC: akses sekolah mencakup petunjuk pendaftaran, perjalanan keluarga, dukungan disabilitas, dan jalur bantuan yang menjaga privasi. Formulir yang tersedia belum menjawab seluruh hambatan. Membaca akses berarti menanyakan apakah keluarga dapat menggunakan layanan dan anak memperoleh dukungan belajar.',
      threads_fact_ids: [], hashtags: ['#GapuraMedia', '#Sosial', '#AksesPendidikan'],
    },
  },
  {
    desk: 'hukum',
    topic: {
      id: 603, desk: 'hukum',
      title: 'SYNTHETIC: Pemeriksaan laporan dugaan pungutan di loket latihan',
      primary_source: 'Redaksi Hukum SYNTHETIC',
      url: 'https://example.org/synthetic/hukum/loket-latihan',
    },
    editorialInput: {
      version: 1, mode: 'current',
      facts: [
        {
          id: 'law_report',
          text: 'SYNTHETIC: Unit Hukum Latihan menerima laporan tentang pengelola loket yang diduga meminta biaya di luar prosedur. Laporan merupakan bahan pemeriksaan, bukan putusan tentang kesalahan.',
          source_url: 'https://example.org/synthetic/hukum/catatan-laporan',
          source_name: 'Catatan Unit Hukum SYNTHETIC',
        },
        {
          id: 'law_statement',
          text: 'SYNTHETIC: Juru Bicara Unit Hukum Latihan menyampaikan, “Dugaan pungutan masih diperiksa dan hak jawab tetap terbuka”. Keterangan ini menjelaskan batas proses dalam simulasi.',
          source_url: 'https://example.org/synthetic/hukum/pernyataan-latihan',
          source_name: 'Pernyataan Unit Hukum SYNTHETIC',
          quote: { text: 'Dugaan pungutan masih diperiksa dan hak jawab tetap terbuka', speaker: 'Juru Bicara Unit Hukum Latihan' },
        },
      ],
    },
    raw: {
      format: 'carousel', mode: 'current',
      angle: 'Membedakan laporan dugaan pungutan, keterangan pemeriksa, dan penilaian tentang kesalahan',
      scope_note: 'SYNTHETIC: perkara, lembaga, dan kutipan sepenuhnya rekaan untuk pengujian; fakta latihan tidak merujuk kasus atau orang nyata.',
      slides: [
        slide(1, 'cover', 'Membuka batas antara laporan dan pembuktian', 'Laporan dugaan pungutan: apa yang boleh disimpulkan?'),
        slide(2, 'lead', 'Menjelaskan isi laporan tanpa menghapus ketidakpastian', 'Dalam perkara SYNTHETIC, Unit Hukum Latihan menerima laporan tentang pengelola loket yang diduga meminta biaya di luar prosedur. Laporan ini merupakan bahan pemeriksaan, bukan putusan tentang kesalahan.', { claim_type: 'fact', fact_ids: ['law_report'] }),
        slide(3, 'official_statement', 'Menghadirkan keterangan langsung dengan atribusi utuh', '“Dugaan pungutan masih diperiksa dan hak jawab tetap terbuka,” kata Juru Bicara Unit Hukum Latihan dalam pernyataan SYNTHETIC.', {
          claim_type: 'fact', fact_ids: ['law_statement'],
          data: { quote: 'Dugaan pungutan masih diperiksa dan hak jawab tetap terbuka', author: 'Juru Bicara Unit Hukum Latihan' },
        }),
        slide(4, 'explanation', 'Membedakan pertanyaan laporan dari ukuran penilaian', 'Isi laporan memberi arah pertanyaan pemeriksaan. Penilaian tentang kesalahan memerlukan pemeriksaan bahan dan kesempatan memberi tanggapan; tuduhan tidak dapat menggantikan proses tersebut.', {
          layout: 'comparison', claim_type: 'analysis',
          data: {
            left: { title: 'Isi laporan', text: 'Hal apa yang perlu diuji melalui dokumen dan tanggapan?' },
            right: { title: 'Penilaian kesalahan', text: 'Bagaimana bahan pemeriksaan mendukung kesimpulan secara sah?' },
          },
        }),
        slide(5, 'public_impact', 'Menjaga ruang aman pelapor dan kesempatan menjawab', 'Pelapor membutuhkan saluran yang aman untuk menyampaikan bahan. Pihak yang dilaporkan juga perlu kesempatan menjawab. Informasi kepada publik sebaiknya menjelaskan batas proses tanpa menyebarkan identitas atau merendahkan martabat pihak terkait.', { claim_type: 'analysis' }),
        slide(6, 'close', 'Memberi batas bahasa pembaca selama pemeriksaan', 'Pertahankan istilah diduga saat merujuk tuduhan yang belum terbukti. Bedakan keterangan pemeriksa dari putusan, dan periksa bahan lanjutan sebelum memberi label bersalah kepada pihak yang dilaporkan.'),
      ],
      caption_blocks: [
        { kind: 'fact', fact_ids: ['law_report'], text: 'SYNTHETIC: Unit Hukum Latihan menerima laporan tentang pengelola loket yang diduga meminta biaya di luar prosedur. Catatan latihan menempatkan laporan sebagai bahan pemeriksaan, bukan putusan tentang kesalahan. Lembaga dan rincian perkara ini merupakan rekaan untuk pengujian editorial.' },
        { kind: 'fact', fact_ids: ['law_statement'], text: '“Dugaan pungutan masih diperiksa dan hak jawab tetap terbuka,” kata Juru Bicara Unit Hukum Latihan dalam keterangan SYNTHETIC. Kutipan rekaan ini menerangkan batas proses: dugaan masih memerlukan pemeriksaan, sementara kesempatan memberi tanggapan tetap menjadi bagian dari keterangan yang disediakan.' },
        { kind: 'analysis', fact_ids: [], text: 'Pembaca perlu memisahkan isi laporan, bahan pemeriksaan, dan penilaian tentang kesalahan. Laporan memberi arah pertanyaan yang perlu diuji. Kelengkapan dokumen dan kesempatan menjawab dapat membantu menjelaskan proses, tetapi banyaknya tuduhan tidak boleh dipakai sebagai pengganti pembuktian.' },
        { kind: 'context', fact_ids: [], text: 'Kepentingan publik juga mencakup perlindungan martabat. Saluran yang aman membantu pelapor menyampaikan bahan tanpa membuka identitas secara sembarangan. Pihak yang dilaporkan perlu ruang tanggapan, sedangkan informasi proses sebaiknya memuat batas yang jelas agar pembaca tidak mengisi kekosongan dengan prasangka.' },
        { kind: 'analysis', fact_ids: [], text: 'Gunakan istilah diduga untuk tuduhan yang belum terbukti dan hindari label bersalah sebelum ada dasar yang sesuai. Keterangan petugas perlu dibaca sesuai isinya, bukan diperluas menjadi putusan. Seluruh contoh ini menguji kehati-hatian bahasa serta atribusi, tanpa menyampaikan kabar tentang kasus nyata.' },
      ],
      threads_body: 'SYNTHETIC: pengelola loket diduga meminta biaya di luar prosedur. “Dugaan pungutan masih diperiksa dan hak jawab tetap terbuka,” kata Juru Bicara Unit Hukum Latihan. Laporan rekaan ini merupakan bahan pemeriksaan, bukan putusan bersalah.',
      threads_fact_ids: ['law_report', 'law_statement'], hashtags: ['#GapuraMedia', '#Hukum', '#PradugaTakBersalah'],
    },
  },
  {
    desk: 'lingkungan',
    topic: {
      id: 604, desk: 'lingkungan',
      title: 'SYNTHETIC: Catatan hujan dan pemeriksaan saluran di Zona Uji',
      primary_source: 'Redaksi Lingkungan SYNTHETIC',
      url: 'https://example.org/synthetic/lingkungan/zona-uji',
    },
    editorialInput: {
      version: 1, mode: 'current',
      facts: [
        {
          id: 'env_rain',
          text: 'SYNTHETIC: Pada 2026-10-12, Pos Lingkungan Latihan mencatat hujan di Zona Uji. Catatan hanya memuat pengamatan hujan dan tidak menyebut penyebab genangan.',
          source_url: 'https://example.org/synthetic/lingkungan/catatan-hujan',
          source_name: 'Catatan Hujan SYNTHETIC',
        },
        {
          id: 'env_inspection',
          text: 'SYNTHETIC: Pada 2026-10-13, Pos Lingkungan Latihan mencatat sumbatan daun di saluran Zona Uji. Pemeriksaan ini tidak mengukur kapasitas keseluruhan saluran.',
          source_url: 'https://example.org/synthetic/lingkungan/pemeriksaan-saluran',
          source_name: 'Pemeriksaan Saluran SYNTHETIC',
        },
        {
          id: 'env_cleanup',
          text: 'SYNTHETIC: Pada 2026-10-14, Pos Lingkungan Latihan mencatat pembersihan sumbatan di saluran Zona Uji. Catatan tidak memuat pengukuran genangan sesudah pembersihan.',
          source_url: 'https://example.org/synthetic/lingkungan/catatan-pembersihan',
          source_name: 'Catatan Pembersihan SYNTHETIC',
        },
      ],
    },
    raw: {
      format: 'carousel', mode: 'current',
      angle: 'Menyusun urutan pengamatan saluran sambil membedakan tindakan pembersihan dari bukti pemulihan',
      scope_note: 'SYNTHETIC: Zona Uji, lembaga, kejadian, serta tanggal adalah rekaan; kronologi ini menguji rujukan bahan latihan dan tidak menggambarkan bencana nyata.',
      slides: [
        slide(1, 'cover', 'Menanyakan celah pengetahuan setelah tindakan lapangan', 'Hujan, sumbatan, pembersihan: apa yang belum terjawab?'),
        slide(2, 'lead', 'Merangkum lingkup catatan pengamatan yang tersedia', 'Catatan SYNTHETIC dari Pos Lingkungan Latihan memuat hujan, temuan sumbatan daun, dan pembersihan saluran di Zona Uji. Rangkaian ini menjelaskan urutan pengamatan dan pekerjaan, tanpa memberi kesimpulan tentang penyebab genangan.', { claim_type: 'fact', fact_ids: ['env_rain', 'env_inspection', 'env_cleanup'] }),
        slide(3, 'chronology', 'Menyajikan urutan kejadian dengan rujukan terpisah per tanggal', 'Kronologi SYNTHETIC menempatkan pengamatan hujan sebelum pemeriksaan saluran dan pembersihan sumbatan. Setiap tahap memiliki catatan tersendiri.', {
          claim_type: 'fact', fact_ids: ['env_rain', 'env_inspection', 'env_cleanup'], layout: 'timeline',
          data: {
            events: [
              { date: '2026-10-12', text: 'Pos Lingkungan Latihan mencatat hujan di Zona Uji dalam simulasi SYNTHETIC.', fact_ids: ['env_rain'] },
              { date: '2026-10-13', text: 'Pos Lingkungan Latihan mencatat sumbatan daun di saluran Zona Uji dalam simulasi SYNTHETIC.', fact_ids: ['env_inspection'] },
              { date: '2026-10-14', text: 'Pos Lingkungan Latihan mencatat pembersihan sumbatan di saluran Zona Uji dalam simulasi SYNTHETIC.', fact_ids: ['env_cleanup'] },
            ],
          },
        }),
        slide(4, 'explanation', 'Menjelaskan mengapa urutan waktu tidak membuktikan sebab', 'Genangan dapat berkaitan dengan aliran permukaan, daya resap tanah, dan kapasitas saluran. Urutan hujan lalu pembersihan tidak cukup untuk memilih penyebab dominan; penjelasan sebab memerlukan pengamatan yang sesuai.', { claim_type: 'analysis' }),
        slide(5, 'public_impact', 'Memisahkan pemantauan risiko dari klaim hasil pekerjaan', 'Warga dapat memperhatikan jalur aman, akses melintasi saluran, dan informasi pengaduan. Untuk menilai manfaat pembersihan, pertanyaan lanjutannya ialah bagaimana aliran serta genangan dipantau dengan cara yang bisa dibandingkan.', { claim_type: 'analysis', layout: 'illustration' }),
        slide(6, 'close', 'Menandai batas hasil dalam catatan pembersihan', 'Catatan pembersihan SYNTHETIC tidak memuat pengukuran genangan sesudah pekerjaan. Hasil pemulihan saluran tidak dapat disimpulkan dari adanya pekerjaan pembersihan saja.', { claim_type: 'fact', fact_ids: ['env_cleanup'] }),
      ],
      caption_blocks: [
        { kind: 'fact', fact_ids: ['env_rain', 'env_inspection'], text: 'SYNTHETIC: Pos Lingkungan Latihan mencatat hujan di Zona Uji pada 2026-10-12 dan sumbatan daun di saluran pada 2026-10-13. Catatan hujan tidak menyebut penyebab genangan, sedangkan pemeriksaan saluran tidak mengukur kapasitas keseluruhannya. Nama tempat serta tanggal ini merupakan bahan rekaan.' },
        { kind: 'fact', fact_ids: ['env_cleanup'], text: 'Pada 2026-10-14, catatan SYNTHETIC memuat pembersihan sumbatan di saluran Zona Uji. Bahan tersebut tidak memuat pengukuran genangan sesudah pekerjaan. Dengan batas itu, keterangan tentang pekerjaan pembersihan tidak memberi dasar untuk menyatakan hasil pemulihan aliran atau keberhasilan penanganan genangan.' },
        { kind: 'analysis', fact_ids: [], text: 'Urutan waktu membantu pembaca memahami hubungan antartahap pengamatan. Namun, urutan tidak membuktikan sebab. Jika ingin menjelaskan genangan, pemeriksaan perlu mempertimbangkan aliran permukaan, kondisi resapan, dan kapasitas saluran, beserta bahan yang mendukung hubungan setiap unsur tersebut.' },
        { kind: 'context', fact_ids: [], text: 'Bagi warga, pertanyaan praktis dapat mencakup jalur aman, akses melintasi saluran, dan saluran pengaduan yang mudah digunakan. Perhatian terhadap keselamatan tidak perlu menunggu kesimpulan mengenai penyebab dominan. Saran pemantauan tetap perlu dibedakan dari laporan kondisi lapangan yang benar-benar tersedia.' },
        { kind: 'analysis', fact_ids: [], text: 'Penilaian pekerjaan memerlukan cara membandingkan kondisi dengan jelas. Bagaimana aliran dipantau, di mana genangan diamati, dan apakah pengamatan memakai cara yang sebanding merupakan pertanyaan lanjutan. Contoh rekaan ini menjaga ruang bagi pertanyaan tersebut tanpa mengarang hasil pengukuran ataupun dampak bencana.' },
      ],
      threads_body: 'SYNTHETIC: di Zona Uji, catatan memuat hujan pada 2026-10-12, sumbatan saluran pada 2026-10-13, dan pembersihan pada 2026-10-14. Pengukuran genangan sesudah pembersihan tidak tersedia dalam catatan. Urutan kejadian rekaan ini tidak membuktikan penyebab ataupun hasil pemulihan.',
      threads_fact_ids: ['env_rain', 'env_inspection', 'env_cleanup'], hashtags: ['#GapuraMedia', '#Lingkungan', '#SaluranKota'],
    },
  },
  {
    desk: 'ekonomi',
    topic: {
      id: 605, desk: 'ekonomi',
      title: 'SYNTHETIC: Tekanan harga pangan pada anggaran rumah tangga',
      primary_source: 'Redaksi Ekonomi SYNTHETIC',
      url: 'https://example.org/synthetic/ekonomi/keranjang-belanja',
    },
    editorialInput: { version: 1, mode: 'explainer', facts: [] },
    raw: {
      format: 'carousel', mode: 'explainer',
      angle: 'Menjelaskan perbedaan antara ukuran harga agregat dan beban keranjang belanja rumah tangga',
      scope_note: 'SYNTHETIC: pembahasan konsep keranjang belanja dan daya beli; tanpa angka inflasi, harga pasar, atau laporan kondisi ekonomi aktual.',
      slides: [
        slide(1, 'cover', 'Menghubungkan pengalaman mahal dengan komposisi kebutuhan', 'Keranjang belanja berbeda, rasa mahal pun bisa berbeda'),
        slide(2, 'lead', 'Menjelaskan peran bobot kebutuhan dalam beban belanja', 'Beban belanja bergantung pada barang yang dibutuhkan dan bagian anggaran untuk membelinya. Jika pangan mengambil porsi besar dalam anggaran keluarga, perubahan harganya dapat terasa berbeda dibandingkan keluarga dengan komposisi pengeluaran lain.'),
        slide(3, 'explanation', 'Memisahkan ukuran agregat dari pengalaman rumah tangga', 'Ukuran harga agregat merangkum sebuah keranjang dengan bobot tertentu. Pengalaman keluarga bergantung pada kebutuhannya sendiri. Perbedaan itu dapat dijelaskan tanpa menganggap pengalaman pribadi sebagai pengganti ukuran umum.', {
          layout: 'comparison',
          data: {
            left: { title: 'Keranjang agregat', text: 'Merangkum perubahan harga berdasarkan komposisi dan bobot yang ditentukan.' },
            right: { title: 'Keranjang keluarga', text: 'Mencerminkan kebutuhan, pilihan barang, dan keterbatasan anggaran rumah tangga.' },
          },
        }),
        slide(4, 'explanation', 'Menjelaskan keterbatasan mengganti barang konsumsi', 'Mengganti merek atau ukuran kemasan bisa membantu menyesuaikan belanja, tetapi pilihan pengganti memiliki batas. Kebutuhan gizi, jarak ke toko, dan waktu berbelanja dapat membatasi penghematan yang tampak mudah di atas kertas.'),
        slide(5, 'public_impact', 'Menghubungkan harga dengan kelonggaran pendapatan', 'Daya beli perlu dibaca bersama pendapatan dan kewajiban rutin. Harga barang yang sama dapat memberi beban berbeda jika kelonggaran anggaran keluarga berbeda. Penilaian tekanan belanja perlu memberi ruang bagi biaya tempat tinggal, transportasi, dan perawatan.'),
        slide(6, 'close', 'Memberi cara membandingkan belanja tanpa mengarang statistik', 'Saat membandingkan belanja, perhatikan jenis barang, ukuran kemasan, mutu, serta kebutuhan keluarga. Pertanyaan tentang perubahan harga akan lebih jelas jika dasar perbandingannya sepadan dan tidak langsung dipakai untuk menebak kondisi seluruh perekonomian.'),
      ],
      caption_blocks: [
        'SYNTHETIC, latihan editorial: rasa mahal dapat berbeda karena isi keranjang belanja dan ruang anggaran rumah tangga berbeda. Keluarga dengan kebutuhan pangan yang besar mungkin merasakan perubahan harga secara berbeda dari keluarga dengan pola pengeluaran lain. Perbandingan perlu dimulai dari komposisi kebutuhan.',
        'Ukuran harga agregat merangkum keranjang dengan bobot tertentu, sementara pengalaman keluarga bergantung pada barang yang benar-benar dibutuhkan. Hubungan ini membantu menjelaskan mengapa pengalaman belanja pribadi bisa berbeda dari gambaran umum tanpa menganggap salah satunya otomatis meniadakan yang lain.',
        'Pilihan pengganti juga memiliki batas. Mengubah merek, ukuran kemasan, atau tempat belanja dapat membantu menyesuaikan pengeluaran, tetapi kebutuhan gizi, biaya perjalanan, dan waktu mencari barang perlu ikut diperhatikan. Penghematan yang tampak mudah belum tentu dapat dilakukan setiap keluarga dengan cara serupa.',
        'Tekanan belanja tidak cukup dibaca dari harga barang saja. Pendapatan dan kewajiban rutin menentukan kelonggaran anggaran yang tersedia. Biaya tempat tinggal, transportasi, dan perawatan dapat membatasi ruang penyesuaian. Karena itu, pertanyaan daya beli perlu menghubungkan harga dengan kondisi anggaran rumah tangga.',
        'Untuk membandingkan pengeluaran, samakan jenis barang, ukuran, serta mutu sejauh memungkinkan. Jelaskan jika kebutuhan atau pilihan barang berbeda. Uraian konseptual ini tidak menyampaikan angka inflasi maupun hasil survei harga; tujuannya memberi dasar yang lebih rapi untuk membaca pengalaman belanja sehari-hari.',
      ].map((text) => ({ kind: 'context', text, fact_ids: [] })),
      threads_body: 'SYNTHETIC: rasa mahal dipengaruhi isi keranjang belanja, pendapatan, dan kewajiban rutin keluarga. Ukuran harga agregat memakai bobot tertentu; pengalaman rumah tangga bisa berbeda. Bandingkan barang, ukuran, dan mutu secara sepadan sebelum menarik kesimpulan tentang tekanan belanja.',
      threads_fact_ids: [], hashtags: ['#GapuraMedia', '#Ekonomi', '#DayaBeli'],
    },
  },
  {
    desk: 'bursa',
    topic: {
      id: 606, desk: 'bursa',
      title: 'SYNTHETIC: Keterbukaan rencana dividen emiten di bursa saham',
      primary_source: 'Redaksi Bursa SYNTHETIC',
      url: 'https://example.org/synthetic/bursa/rencana-dividen',
    },
    editorialInput: { version: 1, mode: 'explainer', facts: [] },
    raw: {
      format: 'carousel', mode: 'explainer',
      angle: 'Membedakan rencana pembagian laba, hak pemegang saham, dan kesiapan kas perusahaan',
      scope_note: 'SYNTHETIC: penjelasan umum tentang membaca rencana dividen; tidak merujuk emiten, jadwal pembagian, atau peluang transaksi saham nyata.',
      slides: [
        slide(1, 'cover', 'Membuka jarak antara rencana perusahaan dan hak investor', 'Rencana dividen belum tentu menjadi hak pemegang saham'),
        slide(2, 'lead', 'Memisahkan laba akuntansi dari ketersediaan kas', 'Laba dan kas menjawab pertanyaan yang berbeda. Perusahaan bisa memiliki kebutuhan modal kerja, investasi, atau kewajiban pembayaran. Membaca rencana dividen perlu memperhatikan kemampuan kas dan kebutuhan usaha, bukan hanya laba yang dibukukan.'),
        slide(3, 'explanation', 'Membandingkan usulan penggunaan laba dan persetujuan pembagian', 'Dalam membaca keterbukaan emiten, bedakan rencana penggunaan laba dari persetujuan pembagian. Tahap dokumen membantu investor memahami apakah bahan yang dibaca berisi usulan atau keputusan yang relevan bagi hak pemegang saham.', {
          layout: 'comparison',
          data: {
            left: { title: 'Rencana penggunaan laba', text: 'Apa alasan perusahaan mengusulkan pembagian dan bagaimana kebutuhan usaha dipertimbangkan?' },
            right: { title: 'Persetujuan pembagian', text: 'Apa ketentuan dokumen yang menjadi dasar hak pemegang saham?' },
          },
        }),
        slide(4, 'explanation', 'Membedakan syarat penerima dari waktu penyaluran', 'Ketentuan penerima dividen dan waktu penyaluran mempunyai fungsi berbeda. Investor perlu membaca syarat pencatatan kepemilikan serta jadwal pembayaran dalam dokumen yang sesuai, tanpa menganggap seluruh pemilik saham otomatis memiliki hak yang sama.'),
        slide(5, 'public_impact', 'Menjelaskan batas dividen sebagai ukuran hasil investasi', 'Dividen merupakan bagian dari penilaian hasil kepemilikan saham. Perubahan nilai saham, biaya transaksi, dan kewajiban perpajakan dapat memengaruhi hasil keseluruhan. Rencana dividen saja tidak cukup untuk menyimpulkan keuntungan atau keamanan investasi.', { claim_type: 'analysis' }),
        slide(6, 'close', 'Memberi urutan baca dokumen sebelum menilai manfaat', 'Baca status rencana, dasar persetujuan, syarat penerima, dan kesiapan pembayaran. Hubungkan pembagian laba dengan kebutuhan kas perusahaan. Kerangka baca ini membantu menilai dokumen tanpa memberi anjuran membeli atau menjual saham.'),
      ],
      caption_blocks: [
        'SYNTHETIC, latihan editorial: rencana dividen perlu dibaca sebagai bagian dari keputusan penggunaan laba perusahaan. Sebelum menganggapnya sebagai uang yang akan diterima, investor perlu memahami status rencana, dasar persetujuan, dan ketentuan penerima. Isi dokumen menentukan pertanyaan yang relevan pada setiap tahap.',
        'Laba akuntansi tidak identik dengan kas yang bebas dibagikan. Perusahaan dapat membutuhkan modal kerja, belanja investasi, atau dana untuk memenuhi kewajiban. Karena itu, pembacaan rencana dividen sebaiknya menghubungkan alasan pembagian dengan arus kas serta kebutuhan usaha, tanpa menilai kemampuan bayar dari laba saja.',
        'Pisahkan usulan penggunaan laba dari persetujuan pembagian. Dokumen usulan menjelaskan pilihan yang diajukan, sedangkan dokumen persetujuan memberi dasar untuk membaca ketentuan hak. Kejelasan tahap membantu investor menghindari kesimpulan bahwa rencana perusahaan otomatis menjadi hak seluruh pemilik saham.',
        'Syarat pencatatan penerima dan waktu pembayaran memiliki fungsi berbeda. Pemahaman keduanya membutuhkan dokumen yang sesuai dengan kepemilikan investor. Jangan mengisi jadwal yang tidak tersedia dengan perkiraan sendiri. Keterangan mengenai proses administrasi juga tidak boleh diperluas menjadi jaminan hasil investasi.',
        'Dividen perlu dibaca bersama perubahan nilai saham, biaya, dan kewajiban perpajakan dalam menilai hasil keseluruhan. Rencana pembagian saja tidak cukup untuk menyatakan sebuah saham menguntungkan atau aman. Kerangka konseptual ini membahas literasi dokumen emiten tanpa menyebut perusahaan nyata atau memberi rekomendasi transaksi.',
      ].map((text) => ({ kind: 'context', text, fact_ids: [] })),
      threads_body: 'SYNTHETIC: membaca rencana dividen berarti memeriksa tahap dokumen, dasar persetujuan, syarat penerima, serta kesiapan kas emiten. Laba tidak identik dengan kas bebas. Rencana pembagian juga tidak menjamin hasil investasi. Kerangka ini membantu membaca keterbukaan, tanpa rekomendasi transaksi.',
      threads_fact_ids: [], hashtags: ['#GapuraMedia', '#Bursa', '#LiterasiDividen'],
    },
  },
];
