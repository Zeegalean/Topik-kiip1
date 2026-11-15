export interface VisaOption {
  code: string;
  label: string;
  labelKo: string;
  descKm: string;
  category: string;
}

export interface VisaGroup {
  groupName: string;
  groupNameKo: string;
  groupNameKm: string;
  items: VisaOption[];
}

export const KOREAN_VISA_GROUPS: VisaGroup[] = [
  {
    groupName: 'E-9 비전문취업 (Non-Professional Employment)',
    groupNameKo: 'E-9 비전문취업',
    groupNameKm: 'វីសាពលករ E-9 (ការងារទូទៅ)',
    items: [
      { code: 'E-9-1', label: 'E-9-1 (제조업 / Manufacturing)', labelKo: 'E-9-1 (제조업)', descKm: 'រោងចក្រ ផលិតកម្ម', category: 'E-9' },
      { code: 'E-9-2', label: 'E-9-2 (건설업 / Construction)', labelKo: 'E-9-2 (건설업)', descKm: 'សំណង់', category: 'E-9' },
      { code: 'E-9-3', label: 'E-9-3 (농축산업 / Agriculture & Livestock)', labelKo: 'E-9-3 (농축산업)', descKm: 'កសិកម្ម និងបសុសត្វ', category: 'E-9' },
      { code: 'E-9-4', label: 'E-9-4 (어업 / Fishery)', labelKo: 'E-9-4 (어업)', descKm: 'នេសាទ', category: 'E-9' },
      { code: 'E-9-5', label: 'E-9-5 (서비스업 / Service)', labelKo: 'E-9-5 (서비스업)', descKm: 'សេវាកម្ម', category: 'E-9' },
      { code: 'E-9', label: 'E-9 (비전문취업 - 일반)', labelKo: 'E-9 (비전문취업 일반)', descKm: 'ពលករទូទៅ', category: 'E-9' },
    ],
  },
  {
    groupName: 'E-7 특정활동 & 숙련기능인력 (Skilled / Professional)',
    groupNameKo: 'E-7 특정활동 · 숙련기능인력',
    groupNameKm: 'វីសាជំនាញ E-7 (ពលករជំនាញ និងអ្នកបច្ចេកទេស)',
    items: [
      { code: 'E-7-4', label: 'E-7-4 (숙련기능인력 / K-Point Skilled)', labelKo: 'E-7-4 (숙련기능인력)', descKm: 'ពលករជំនាញ K-point E7-4', category: 'E-7' },
      { code: 'E-7-4R', label: 'E-7-4R (지역특화 숙련기능인력)', labelKo: 'E-7-4R (지역특화 숙련기능인력)', descKm: 'ពលករជំនាញតំបន់ជនបទ', category: 'E-7' },
      { code: 'E-7-1', label: 'E-7-1 (특정활동 - 전문인력)', labelKo: 'E-7-1 (특정활동 전문인력)', descKm: 'អ្នកជំនាញកម្រិតខ្ពស់', category: 'E-7' },
      { code: 'E-7-2', label: 'E-7-2 (준전문인력)', labelKo: 'E-7-2 (준전문인력)', descKm: 'អ្នកជំនាញកម្រិតមធ្យម', category: 'E-7' },
      { code: 'E-7-3', label: 'E-7-3 (일반기능인력)', labelKo: 'E-7-3 (일반기능인력)', descKm: 'អ្នកជំនាញទូទៅ', category: 'E-7' },
      { code: 'E-7', label: 'E-7 (특정활동 - 일반)', labelKo: 'E-7 (특정활동 일반)', descKm: 'វីសា E-7 ទូទៅ', category: 'E-7' },
      { code: 'E-8', label: 'E-8 (계절근로 / Seasonal Worker)', labelKo: 'E-8 (계절근로)', descKm: 'ពលករតាមរដូវកាល', category: 'E-8' },
    ],
  },
  {
    groupName: 'F 거주·영주·동반·결혼 (Residence & Family)',
    groupNameKo: 'F 거주 · 영주 · 동반 · 결혼',
    groupNameKm: 'វីសាស្នាក់នៅ F (រៀបការ គ្រួសារ ស្នាក់នៅអចិន្ត្រៃយ៍)',
    items: [
      { code: 'F-2-R', label: 'F-2-R (지역특화형 거주비자)', labelKo: 'F-2-R (지역특화형 거주)', descKm: 'វីសាតំបន់ជនបទ (Regional Residence)', category: 'F' },
      { code: 'F-2-1', label: 'F-2-1 (거주)', labelKo: 'F-2-1 (거주)', descKm: 'ស្នាក់នៅទូទៅ', category: 'F' },
      { code: 'F-2-7', label: 'F-2-7 (점수제 우수인재)', labelKo: 'F-2-7 (점수제 우수인재)', descKm: 'ស្នាក់នៅតាមប្រព័ន្ធពិន្ទុ', category: 'F' },
      { code: 'F-2-99', label: 'F-2-99 (장기체류자)', labelKo: 'F-2-99 (장기체류자)', descKm: 'ស្នាក់នៅរយៈពេលវែង', category: 'F' },
      { code: 'F-2', label: 'F-2 (거주비자)', labelKo: 'F-2 (거주)', descKm: 'វីសាស្នាក់នៅ F-2', category: 'F' },
      { code: 'F-6-1', label: 'F-6-1 (국민의 배우자 / 결혼이민)', labelKo: 'F-6-1 (결혼이민 · 국민의 배우자)', descKm: 'រៀបការជាមួយជនជាតិកូរ៉េ', category: 'F' },
      { code: 'F-6-2', label: 'F-6-2 (자녀양육)', labelKo: 'F-6-2 (자녀양육)', descKm: 'ចិញ្ចឹមកូន', category: 'F' },
      { code: 'F-3', label: 'F-3 (동반가족 / Dependent Family)', labelKo: 'F-3 (동반가족)', descKm: 'គ្រួសារកំដរ (ស្វាមី/ភរិយា/កូន)', category: 'F' },
      { code: 'F-3-R', label: 'F-3-R (지역특화 동반)', labelKo: 'F-3-R (지역특화 동반)', descKm: 'គ្រួសារកំដរតំបន់ជនបទ', category: 'F' },
      { code: 'F-1', label: 'F-1 (방문동거)', labelKo: 'F-1 (방문동거)', descKm: 'ស្នាក់នៅជាមួយគ្រួសារ', category: 'F' },
      { code: 'F-1-15', label: 'F-1-15 (우수인재 부모초청)', labelKo: 'F-1-15 (우수인재 부모초청)', descKm: 'ឪពុកម្តាយពលករជំនាញ/និស្សិត', category: 'F' },
      { code: 'F-5', label: 'F-5 (영주권 / Permanent Residence)', labelKo: 'F-5 (영주)', descKm: 'សិទ្ធិជ្រកកោនអចិន្ត្រៃយ៍', category: 'F' },
      { code: 'F-4', label: 'F-4 (재외동포)', labelKo: 'F-4 (재외동포)', descKm: 'អាណិកជនកូរ៉េ', category: 'F' },
    ],
  },
  {
    groupName: 'D 유학·연수·구직 (Study & Job Seeking)',
    groupNameKo: 'D 유학 · 연수 · 구직',
    groupNameKm: 'វីសាសិក្សា D (និស្សិត និងស្វែងរកការងារ)',
    items: [
      { code: 'D-2', label: 'D-2 (유학 / Degree Student)', labelKo: 'D-2 (유학)', descKm: 'និស្សិតសកលវិទ្យាល័យ', category: 'D' },
      { code: 'D-2-1', label: 'D-2-1 (전문학사 / Associate Degree)', labelKo: 'D-2-1 (전문학사)', descKm: 'មហាវិទ្យាល័យបច្ចេកទេស', category: 'D' },
      { code: 'D-2-2', label: 'D-2-2 (학사 / Bachelor)', labelKo: 'D-2-2 (학사)', descKm: 'បរិញ្ញាបត្រ', category: 'D' },
      { code: 'D-2-3', label: 'D-2-3 (석사 / Master)', labelKo: 'D-2-3 (석사)', descKm: 'អនុបណ្ឌិត', category: 'D' },
      { code: 'D-2-4', label: 'D-2-4 (박사 / Ph.D)', labelKo: 'D-2-4 (박사)', descKm: 'បណ្ឌិត', category: 'D' },
      { code: 'D-4', label: 'D-4 (일반연수 / General Training)', labelKo: 'D-4 (일반연수)', descKm: 'វគ្គបណ្តុះបណ្តាល', category: 'D' },
      { code: 'D-4-1', label: 'D-4-1 (한국어연수 / Korean Language)', labelKo: 'D-4-1 (한국어연수)', descKm: 'រៀនភាសាកូរ៉េ', category: 'D' },
      { code: 'D-10', label: 'D-10 (구직 / Job Seeking)', labelKo: 'D-10 (구직)', descKm: 'ស្វែងរកការងារ', category: 'D' },
      { code: 'D-10-1', label: 'D-10-1 (일반구직)', labelKo: 'D-10-1 (일반구직)', descKm: 'ស្វែងរកការងារទូទៅ', category: 'D' },
    ],
  },
  {
    groupName: 'H & G 기타 체류자격 (Other)',
    groupNameKo: 'H · G 기타 체류자격',
    groupNameKm: 'វីសាផ្សេងៗ (H-2, G-1)',
    items: [
      { code: 'H-2', label: 'H-2 (방문취업 / Working Visit)', labelKo: 'H-2 (방문취업)', descKm: 'ទស្សនកិច្ចការងារ', category: 'H' },
      { code: 'G-1', label: 'G-1 (기타 / Miscellaneous)', labelKo: 'G-1 (기타)', descKm: 'ផ្សេងៗ (ព្យាបាល វិវាទការងារ)', category: 'G' },
    ],
  },
];

export const ALL_VISA_CODES: string[] = KOREAN_VISA_GROUPS.flatMap((g) =>
  g.items.map((i) => i.code)
);
