export const DISCOVERY_TOPICS = {
  politik: { id: 1, title: 'DPR membahas kebijakan layanan publik', primary_source: 'Media Uji', url: 'https://example.org/politik', desk: 'politik' },
  sosial: { id: 2, title: 'Akses sekolah bagi warga menjadi perhatian', primary_source: 'Media Uji', url: 'https://example.org/sosial', desk: 'sosial' },
  hukum: { id: 3, title: 'Dugaan pelanggaran dibahas dalam proses hukum', primary_source: 'Media Uji', url: 'https://example.org/hukum', desk: 'hukum' },
  lingkungan: { id: 4, title: 'Risiko banjir dan ruang hijau kota', primary_source: 'Media Uji', url: 'https://example.org/lingkungan', desk: 'lingkungan' },
  ekonomi: { id: 5, title: 'Harga pangan dan kebijakan ekonomi nasional', primary_source: 'Media Uji', url: 'https://example.org/ekonomi', desk: 'ekonomi' },
  bursa: { id: 6, title: 'Keterbukaan informasi perusahaan di bursa saham', primary_source: 'Media Uji', url: 'https://example.org/bursa', desk: 'bursa' },
};

// Authored synthetic explanation for runtime tests; not output from a model.
export function originalFixture(brief = {}) {
  const purpose = ['Pertanyaan pembaca', 'Mekanisme keputusan', 'Akses informasi', 'Posisi warga', 'Arti kebijakan', 'Batas kesimpulan'];
  const prose = [
    'Bagaimana keputusan publik menyentuh kehidupan warga?',
    'Sebuah kebijakan dapat dipahami dengan melihat siapa yang berwenang, masalah yang ingin dijawab, dan cara pelaksanaannya. Pertanyaan ini membantu pembaca membedakan tujuan kebijakan dari hasil yang masih perlu diamati.',
    'Informasi yang mudah ditemukan membantu warga menilai sebuah keputusan. Penjelasan prosedur, syarat, dan jalur pertanyaan memberi pegangan untuk memahami akses terhadap layanan tanpa menganggap semua kelompok memiliki pengalaman yang sama.',
    'Dampak kebijakan dapat berbeda menurut kebutuhan dan kondisi warga. Karena itu, pembahasan perlu menyisakan ruang bagi pengalaman kelompok yang aksesnya terbatas serta menjelaskan pilihan yang tersedia tanpa menjanjikan hasil tertentu.',
    'Konteks ekonomi dan lingkungan dapat menjadi pertimbangan ketika menjelaskan suatu pilihan. Hubungan tersebut perlu dibahas secara bersyarat: perubahan aturan dapat memengaruhi perilaku, tetapi besar dampaknya memerlukan bahan yang sesuai.',
    'Membaca isu secara utuh berarti membedakan mekanisme umum dari informasi kejadian. Judul membantu menemukan pertanyaan, sedangkan kesimpulan tentang perkembangan aktual memerlukan catatan dan rujukan yang dapat diperiksa pembaca.',
  ];
  const caption = [
    'Sebuah judul berita sering mempertemukan kita dengan pertanyaan yang lebih luas: bagaimana keputusan publik bekerja, siapa yang dapat mengakses manfaatnya, dan apa yang perlu diperhatikan warga. Penjelasan ini membahas cara membaca isu, sehingga tujuan kebijakan tidak langsung disamakan dengan hasil yang sudah tercapai.',
    'Langkah awal adalah memahami kewenangan dan prosedur. Keputusan dapat melibatkan lembaga dengan tugas berbeda, sementara pelaksanaan bergantung pada petunjuk dan akses informasi. Pembaca dapat menanyakan bagaimana syarat dijelaskan, saluran pertanyaan tersedia, dan tanggung jawab pelaksana diterangkan dengan bahasa yang mudah dipahami.',
    'Sesudah itu, lihat kebutuhan masyarakat yang beragam. Hambatan akses dapat berkaitan dengan lokasi, biaya, waktu, atau kemampuan memahami prosedur. Dampak yang diharapkan perlu dibaca sebagai kemungkinan yang memiliki syarat, bukan jaminan bahwa setiap kelompok akan mengalami perubahan yang sama.',
    'Konteks sosial, hukum, lingkungan, dan ekonomi dapat membantu menjelaskan hubungan antarpilihan. Namun, menghubungkan sebuah isu dengan konteks yang lebih luas tidak memberi izin untuk menambahkan angka, ucapan, atau rincian peristiwa. Klaim aktual memerlukan bahan yang sesuai dan atribusi yang jelas.',
    'Pegangan akhirnya adalah membedakan apa yang sedang dijelaskan dari apa yang sudah diketahui tentang sebuah kejadian. Judul berguna sebagai pintu masuk pembahasan; pertanyaan lanjutan membantu mencari informasi yang masih dibutuhkan. Dengan cara ini, warga dapat mengikuti isu tanpa tergesa mengambil kesimpulan yang belum didukung bahan.',
  ];
  const raw = {
    format: 'carousel', mode: brief.mode || 'explainer',
    angle: 'Membaca hubungan keputusan publik dengan kebutuhan warga',
    scope_note: 'Penjelasan mekanisme umum dari topik discovery; tidak menyatakan rincian kejadian terbaru telah dikonfirmasi.',
    slides: prose.map((teks, index) => ({
      no: index + 1, role: index === 0 ? 'cover' : index === 5 ? 'close' : 'explanation',
      purpose: purpose[index], claim_type: 'context', fact_ids: [],
      layout: index === 0 ? 'cover-focus' : 'big-statement', teks,
      data: index === 0 ? { title: teks } : {},
    })),
    caption_blocks: caption.map((text) => ({ kind: 'context', text, fact_ids: [] })),
    threads_body: 'Memahami isu publik dimulai dengan membedakan tujuan kebijakan, cara pelaksanaan, dan dampak yang masih perlu diamati. Perhatikan kewenangan, akses informasi, serta kebutuhan warga. Pembahasan ini menjelaskan mekanisme umum; rincian kejadian aktual memerlukan catatan dan rujukan yang tersedia.',
    threads_fact_ids: [], hashtags: ['#GapuraMedia', '#IsuPublik'],
  };
  if (brief.mode === 'current' && brief.facts?.[0]) {
    const facts = brief.facts.slice(0, 3);
    facts.forEach((fact, index) => {
      raw.slides[index + 1] = { ...raw.slides[index + 1], teks: `${fact.text} Rincian ini memberi konteks bagi pembaca untuk memahami perkembangan berita secara lebih utuh sesuai informasi yang tersedia.`, claim_type: 'fact', fact_ids: [fact.id] };
    });
    raw.caption_blocks = facts.map((fact) => ({ kind: 'fact', text: fact.text, fact_ids: [fact.id] })).concat(raw.caption_blocks);
  }
  return raw;
}
