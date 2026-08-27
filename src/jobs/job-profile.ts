import { RoleType } from './job-status.enum';

/**
 * Umer's CV as STRUCTURED DATA — the single source of truth the CV renderer and
 * the Claude tailoring step build on.
 *
 * INTEGRITY RULES (enforced everywhere downstream — see the project memory
 * "feedback-cv-tailoring-integrity"):
 *   • Experience (companies, roles, dates, projects, and what he actually built)
 *     is FIXED TRUTH and must never be altered or fabricated.
 *   • Only the professional SUMMARY and the SKILLS section adapt to a JD, and
 *     skills may only be REORDERED/EMPHASIZED from SKILL_INVENTORY — never
 *     invented.
 *   • The rendered CV is always exactly 2 pages.
 */

export const CV_HEADER = {
  name: 'MUHAMMAD UMER BILAL',
  email: 'mumerbilal142@gmail.com',
  phone: '+971 55 969 5281',
  location: 'Al Warqa, Dubai, UAE',
  visa: 'UAE Employment Visa Holder',
  linkedin: 'linkedin.com/in/muhammad-umer-bilal-b1a9391a2',
  github: 'github.com/umerbilalgujjar142',
};

/** One fixed employment/project block. Bullets are real and must not change. */
export interface CvExperience {
  company: string;
  role: string;
  dates: string;
  location: string;
  project: string;
  bullets: string[];
}

export interface CvVariant {
  key: string;
  /** Headline under the name. */
  title: string;
  /** Base professional summary (the tailoring step rewrites this to the JD). */
  summary: string;
  /** Ordered skill groups (the tailoring step may reorder/emphasize these). */
  skillGroups: { label: string; skills: string[] }[];
  /** FIXED experience — never altered by tailoring. */
  experience: CvExperience[];
}

export const CV_EDUCATION = {
  degree: 'Master of Science — Computer Networks and Security',
  institution: 'National University of Computer and Emerging Sciences (FAST-NUCES)',
  years: '2021 – 2023',
};

export const CV_CERTIFICATIONS = [
  'Microsoft Certified: Azure Fundamentals — Microsoft (Credential ID 4081CEA4C0DB1581)',
];

export const CV_LANGUAGES = 'English — Professional Working Proficiency | Urdu — Native Speaker';

// ---------------------------------------------------------------------------
// Fixed experience, phrased per role family (transcribed from Umer's 3 CVs).
// Facts are identical across variants; emphasis differs. NEVER fabricate.
// ---------------------------------------------------------------------------

const EXP_BACKEND: CvExperience[] = [
  {
    company: 'SoftBuilders Software Design LLC',
    role: 'Senior Software Developer',
    dates: 'Oct 2024 – Present',
    location: 'Dubai, UAE',
    project: 'Motifino — Digital Membership & Smart Business-Card Platform',
    bullets: [
      'Built the REST API in NestJS with Sequelize and PostgreSQL covering authentication, orders, credits, referrals, membership tiers, notifications, and support services.',
      'Integrated Apple Wallet (PassKit) and Google Wallet membership passes end to end — certificate-based pass signing, Google Wallet REST integration with in-place pass refresh.',
      'Implemented peer-to-peer credit transfers by card code with automatic notifications for admin-issued credits, order events, and reward milestones.',
      'Added an LLM-powered personalized offer/reward recommendation feature using Retrieval-Augmented Generation (RAG) on Azure AI Foundry.',
      'Set up CI/CD with Bitbucket Pipelines and centralized secret management through Infisical for secure, zero-downtime deployments.',
    ],
  },
  {
    company: 'SoftBuilders Software Design LLC',
    role: 'Senior Software Developer',
    dates: 'Oct 2024 – Present',
    location: 'Dubai, UAE',
    project: 'MAI HRMS — Cloud-Based HR Management Platform',
    bullets: [
      'Built NestJS backend modules exposing REST APIs consumed by both the web portal and a React Native mobile app.',
      'Built geofenced check-in/check-out logic with adjustable radii and exception-request workflows, plus QR-based document upload and e-signature endpoints.',
      'Developed smart, multi-level, role-based approval workflow automation with real-time status tracking.',
      'Executed multi-role, permission-scoped access control for HR admins, line managers, and employees, with audit logging.',
    ],
  },
  {
    company: 'AlphaSquad Technologies',
    role: 'Senior Software Engineer',
    dates: 'Sept 2023 – Jul 2024',
    location: 'Islamabad, Pakistan',
    project: 'Pluckers Restaurant App',
    bullets: [
      'Built a Node.js, Express.js, and Sequelize backend on PostgreSQL handling real-time order processing, loyalty rewards, and membership management.',
      'Integrated PayPal SDK for recurring subscription billing and one-time transactions with webhook-based payment reconciliation.',
      'Deployed FCM push notifications via a dedicated microservice with retry logic; profiled and reduced average API response times.',
      'Mentored junior backend engineers on Node.js best practices, RESTful API design, and test-driven development.',
    ],
  },
  {
    company: 'GreenAge Services',
    role: 'Software Engineer',
    dates: 'Mar 2020 – Aug 2023',
    location: 'Islamabad, Pakistan',
    project: 'Agronomics — Agricultural Intelligence Platform',
    bullets: [
      'Delivered backend APIs for real-time crop analytics, weather aggregation, and ML-driven health assessments via GraphQL and REST.',
      'Merged third-party weather APIs and satellite imagery into unified GraphQL endpoints surfacing real-time NDVI data.',
      'Maintained MongoDB schemas for soil records, farm logs, and time-series data; scheduled Cron Jobs for periodic aggregation.',
      'Refined GraphQL synchronization with pagination, field-level caching, and batched resolution, cutting response times ~35%.',
    ],
  },
];

const EXP_FULLSTACK: CvExperience[] = [
  {
    company: 'SoftBuilders Software Design LLC',
    role: 'Senior Software Developer',
    dates: 'Oct 2024 – Present',
    location: 'Dubai, UAE',
    project: 'Motifino — Digital Membership & Smart Business-Card Platform',
    bullets: [
      'Built and maintained the full stack across four codebases — REST API, member mobile app, admin panel, and public web app.',
      'Developed the member mobile app in React Native (Expo): wallet, orders, rewards, referrals, notifications, multi-language UI, and native contacts/NFC.',
      'Developed the admin panel in React with Vite, TanStack Query, Redux, and shadcn/ui — user management, credit issuance, offers, and support ticketing.',
      'Built the REST API in NestJS with Sequelize and PostgreSQL; integrated Apple/Google Wallet passes and an LLM/RAG recommendation feature on Azure AI Foundry.',
    ],
  },
  {
    company: 'SoftBuilders Software Design LLC',
    role: 'Senior Software Developer',
    dates: 'Oct 2024 – Present',
    location: 'Dubai, UAE',
    project: 'MAI HRMS — Cloud-Based HR Management Platform',
    bullets: [
      'Contributed across the full stack — React Native mobile screens and NestJS backend modules consumed via REST across web and mobile.',
      'Built the geofenced check-in/check-out module, QR document upload, e-signature flows, and smart multi-level approval workflows with real-time tracking.',
      'Delivered performance and asset-management features (360° feedback, KPI/OKR tracking, asset assignment) with mobile-first employee experiences.',
      'Executed multi-role, permission-scoped access control with tailored dashboards and audit logging on both frontend and backend.',
    ],
  },
  {
    company: 'AlphaSquad Technologies',
    role: 'Senior Software Engineer',
    dates: 'Sept 2023 – Jul 2024',
    location: 'Islamabad, Pakistan',
    project: 'Pluckers Restaurant App',
    bullets: [
      'Built the full stack — React Native frontend with real-time order tracking and a Node.js / Express.js / PostgreSQL backend with Sequelize.',
      'Configured FCM push notifications; integrated PayPal SDK for recurring subscription billing and one-time transactions.',
      'Wrote Jest and Jasmine unit tests across backend modules and React Native components; profiled and reduced backend response times.',
      'Configured deep linking and React Navigation for smooth flows across campaigns and push click-throughs on iOS and Android.',
    ],
  },
  {
    company: 'GreenAge Services',
    role: 'Software Engineer',
    dates: 'Mar 2020 – Aug 2023',
    location: 'Islamabad, Pakistan',
    project: 'Agronomics — Agricultural Intelligence Platform',
    bullets: [
      'Delivered full stack — React Native mobile app paired with a Node.js / Express.js backend exposing REST and GraphQL APIs.',
      'Merged weather APIs, satellite imagery, and ML models into unified GraphQL endpoints powering real-time NDVI crop-health assessments.',
      'Designed scalable MongoDB and PostgreSQL schemas; formulated indexing strategies reducing dashboard query times ~35%.',
      'Built JWT role-based auth and an offline-first strategy (MMKV caching, background sync) for low-connectivity rural use.',
    ],
  },
];

const EXP_MOBILE: CvExperience[] = [
  {
    company: 'SoftBuilders Software Design LLC',
    role: 'Senior Software Developer',
    dates: 'Oct 2024 – Present',
    location: 'Dubai, UAE',
    project: 'Motifino — Digital Membership & Smart Business-Card Platform',
    bullets: [
      'Built the member mobile app in React Native (Expo) — wallet, orders, rewards, referrals, notifications, multi-language UI, and native contacts/NFC.',
      'Implemented in-app Apple Wallet and Google Wallet card provisioning with automatic pass refresh on tier changes.',
      'Built the NFC/QR business-card sharing flow and peer-to-peer credit transfers with FCM push and per-type deep-linking.',
      'Surfaced an LLM/RAG personalized rewards feature (Azure AI Foundry) in the mobile app; backed by a NestJS + PostgreSQL API.',
    ],
  },
  {
    company: 'SoftBuilders Software Design LLC',
    role: 'Senior Software Developer',
    dates: 'Oct 2024 – Present',
    location: 'Dubai, UAE',
    project: 'MAI HRMS — Cloud-Based HR Management Platform',
    bullets: [
      'Built React Native mobile screens — attendance/geofenced check-in, leave requests, payslip access, and document upload — via shared REST APIs.',
      'Implemented the geofenced check-in/check-out flow with adjustable radii and exception-request submission from mobile.',
      'Built a QR document-upload flow and a natural-language AI assistant screen for instant HR answers on mobile.',
      'Delivered mobile performance-tracking and asset-request views with tailored dashboards and per-role permissions.',
    ],
  },
  {
    company: 'AlphaSquad Technologies',
    role: 'Senior Software Engineer',
    dates: 'Sept 2023 – Jul 2024',
    location: 'Islamabad, Pakistan',
    project: 'Pluckers Restaurant App',
    bullets: [
      'Built the full React Native app (iOS & Android) with real-time order tracking, live kitchen status, and secure in-app payments.',
      'Applied real-time FCM push notifications for promotions, events, and loyalty milestones, driving repeat visits.',
      'Designed a Node.js / Express.js / Sequelize backend on PostgreSQL; integrated PayPal SDK for subscriptions and one-time payments.',
      'Performed performance profiling and memory optimization, reducing startup time and improving frame rates on mid-range Android.',
    ],
  },
  {
    company: 'GreenAge Services',
    role: 'Software Engineer',
    dates: 'Mar 2020 – Aug 2023',
    location: 'Islamabad, Pakistan',
    project: 'Agronomics — Agricultural Intelligence Platform',
    bullets: [
      'Delivered the React Native app (Android & iOS) giving farmers real-time crop analytics, field reports, and actionable insights.',
      'Merged weather APIs, satellite imagery, and ML prediction models into the mobile interface for instant NDVI assessments.',
      'Architected an offline-first strategy (MMKV caching, background sync) for full functionality in low-connectivity field environments.',
      'Built interactive dashboards for soil data and vegetation-index tracking with custom React Native UI components.',
    ],
  },
];

export const CV_VARIANTS: Record<string, CvVariant> = {
  backend: {
    key: 'backend',
    title: 'Senior Backend Developer — Node.js | NestJS | Microservices | REST APIs',
    summary:
      'Senior Backend Developer with 6 years of experience architecting and delivering scalable, high-performance server-side systems across SaaS, logistics, fintech, and enterprise platforms. Deep expertise in Node.js, NestJS, and microservices with hands-on database design, REST API development, event-driven systems, and cloud infrastructure. Experienced integrating LLM-powered features (RAG, Azure AI Foundry) into production backends, along with ORMs, message queues, and CI/CD pipelines.',
    skillGroups: [
      { label: 'Languages', skills: ['JavaScript', 'TypeScript', 'SQL', 'Bash'] },
      { label: 'Backend', skills: ['Node.js', 'Express.js', 'NestJS', 'RESTful APIs', 'Microservices', 'Caching', 'Cron Jobs', 'JWT', 'OAuth 2.0'] },
      { label: 'Architecture', skills: ['Microservices', 'Event-driven Architecture', 'API Gateway', 'Domain-Driven Design', 'SOLID Principles'] },
      { label: 'ORM / DB', skills: ['TypeORM', 'Sequelize', 'Prisma', 'Mongoose', 'MongoDB', 'PostgreSQL', 'MySQL', 'Redis'] },
      { label: 'Messaging', skills: ['Kafka', 'RabbitMQ', 'WebSockets', 'Pub/Sub'] },
      { label: 'AI / LLM', skills: ['LLM Integration', 'RAG', 'Azure AI Foundry', 'Prompt Engineering'] },
      { label: 'Cloud & DevOps', skills: ['AWS (S3, EC2)', 'Docker', 'Nginx', 'Linux', 'Firebase', 'CI/CD', 'Bitbucket Pipelines', 'Git'] },
      { label: 'Frontend', skills: ['React.js', 'React Native', 'Next.js', 'Redux'] },
    ],
    experience: EXP_BACKEND,
  },
  fullstack: {
    key: 'fullstack',
    title: 'Senior Full Stack Developer — React.js | Node.js | React Native | AI-Powered Apps',
    summary:
      'Senior Full Stack Developer with 6 years of experience delivering end-to-end web and mobile applications across SaaS, logistics, fintech, and enterprise domains. Equally strong across frontend and backend — React.js, Next.js, and React Native on the client; Node.js, NestJS, and microservices on the server. Deep expertise in cloud infrastructure, database architecture, and integrating LLM-powered features (RAG, Azure AI Foundry) into production applications.',
    skillGroups: [
      { label: 'Languages', skills: ['JavaScript', 'TypeScript', 'HTML5', 'CSS3', 'SQL', 'Bash'] },
      { label: 'Frontend', skills: ['React.js', 'Next.js', 'Redux', 'Vite', 'TanStack Query', 'shadcn/ui', 'Tailwind CSS'] },
      { label: 'Mobile', skills: ['React Native', 'Native Modules', 'iOS (Xcode)', 'Android Studio', 'TestFlight'] },
      { label: 'Backend', skills: ['Node.js', 'Express.js', 'NestJS', 'RESTful APIs', 'Microservices', 'JWT', 'OAuth 2.0'] },
      { label: 'Testing', skills: ['Jest', 'Enzyme', 'Jasmine', 'Detox', 'Postman'] },
      { label: 'Databases', skills: ['MongoDB', 'PostgreSQL', 'MySQL', 'Redis', 'TypeORM', 'Sequelize', 'Prisma'] },
      { label: 'AI / LLM', skills: ['LLM Integration', 'RAG', 'Azure AI Foundry', 'Prompt Engineering'] },
      { label: 'Cloud & DevOps', skills: ['AWS (S3, EC2)', 'Docker', 'Firebase', 'Nginx', 'Linux', 'CI/CD', 'Bitbucket Pipelines', 'Git'] },
    ],
    experience: EXP_FULLSTACK,
  },
  mobile: {
    key: 'mobile',
    title: 'React Native & Full Stack Mobile App Developer',
    summary:
      'Senior React Native & Full Stack Mobile App Developer with 6 years of experience designing, building, and deploying cross-platform iOS and Android applications. Proven expertise across the full mobile lifecycle — from architecture and native module integration to App Store and Play Store deployment. Deep backend experience with Node.js and NestJS microservices and hands-on experience integrating LLM-powered features (RAG, Azure AI Foundry) into mobile products.',
    skillGroups: [
      { label: 'Mobile', skills: ['React Native', 'Native Modules', 'iOS (Xcode)', 'Android Studio', 'FCM Push', 'Gradle', 'CocoaPods', 'TestFlight'] },
      { label: 'Frontend', skills: ['React.js', 'Next.js', 'Redux', 'React Navigation', 'Reanimated 2', 'Gesture Handler'] },
      { label: 'Ecosystem', skills: ['TanStack Query', 'AsyncStorage / MMKV', 'Flipper', 'Jest', 'Detox'] },
      { label: 'Backend', skills: ['Node.js', 'Express.js', 'NestJS', 'RESTful APIs', 'GraphQL', 'Microservices', 'JWT', 'OAuth 2.0'] },
      { label: 'AI / LLM', skills: ['LLM Integration', 'RAG', 'Azure AI Foundry', 'Prompt Engineering'] },
      { label: 'Databases', skills: ['MongoDB', 'PostgreSQL', 'MySQL', 'Redis'] },
      { label: 'DevOps & Tools', skills: ['Docker', 'CI/CD', 'Bitbucket Pipelines', 'AWS S3', 'Git', 'Agile / Scrum'] },
    ],
    experience: EXP_MOBILE,
  },
};

/**
 * Flat inventory of every skill Umer genuinely has (union of the 3 CVs). The
 * tailoring step may ONLY draw skills from this list — it must never invent a
 * skill just because a JD asks for it.
 */
/**
 * Extra matchable skills beyond the CV skill groups — AI/LLM API terms and tools
 * Umer genuinely uses, so JDs mentioning them score higher. These are for
 * MATCHING only (they don't change the rendered CV).
 */
const EXTRA_MATCH_SKILLS = [
  'OpenAI', 'OpenAI API', 'Claude', 'Anthropic', 'GenAI', 'Generative AI', 'LLM',
  'GitHub Copilot', 'Cursor', 'Vector Database', 'Embeddings', 'Azure', 'Azure OpenAI',
  'Kafka', 'RabbitMQ', 'WebSockets', 'Pub/Sub', 'Event-driven', 'GraphQL',
  'Shopify', 'PayPal', 'Stripe', 'Apple Wallet', 'Google Wallet', 'Firebase',
  'Serverless', 'Lambda', 'Kubernetes', 'Terraform', 'MERN',
];

export const SKILL_INVENTORY: string[] = Array.from(
  new Set([
    ...Object.values(CV_VARIANTS).flatMap((v) => v.skillGroups.flatMap((g) => g.skills)),
    ...EXTRA_MATCH_SKILLS,
  ]),
);

/**
 * Umer's REAL, hand-designed CV PDFs (the ones he uses daily). Attached to
 * applications AS-IS per role family — his polished design beats a generated
 * one, and the PDF text can't be safely edited without breaking the layout.
 * Per-JD adaptation therefore happens in the cover letter + form answers, not
 * the CV. Paths overridable via env (CV_BACKEND_PATH / CV_FULLSTACK_PATH /
 * CV_MOBILE_PATH).
 */
export const REAL_CV_FILES: Record<'backend' | 'fullstack' | 'mobile', string> = {
  backend: '/Users/muhammadumerbilal/Documents/MUHAMMAD-UMER-BILAL-Backend-Developer.pdf',
  fullstack: '/Users/muhammadumerbilal/Documents/MUHAMMAD-UMER-BILAL-Full-Stack-Developer.pdf',
  mobile: '/Users/muhammadumerbilal/Documents/MUHAMMAD-UMER-BILAL-Mobile-Application-Developer.pdf',
};

/** Pick the base CV variant for a role classification. */
export function cvVariantFor(role: RoleType): CvVariant {
  if (role === RoleType.BACKEND) return CV_VARIANTS.backend;
  if (role === RoleType.MOBILE) return CV_VARIANTS.mobile;
  // fullstack is the sensible default for "other"/ambiguous engineering roles.
  return CV_VARIANTS.fullstack;
}

// ---------------------------------------------------------------------------
// Work authorization — drives the sponsorship logic.
// ---------------------------------------------------------------------------

/** Countries where Umer can work without new visa sponsorship. */
const NO_SPONSORSHIP_COUNTRIES = new Set(
  ['united arab emirates', 'uae', 'saudi arabia', 'ksa', 'pakistan'].map((s) => s.toLowerCase()),
);

/**
 * Whether THIS job would require visa sponsorship for Umer.
 *   remote            → false (no relocation)
 *   UAE / GCC / home  → false (already authorized / local)
 *   anywhere else     → true
 * `null` country stays `true` (unknown foreign → assume sponsorship needed) unless remote.
 */
export function jobNeedsSponsorship(country: string | null, remote: boolean): boolean {
  if (remote) return false;
  if (!country) return true;
  return !NO_SPONSORSHIP_COUNTRIES.has(country.trim().toLowerCase());
}

/**
 * Salary expectation to put on a form, by job country. Umer gave a concrete UAE
 * range (6 yrs experience); for every other market he has no figure, so we state
 * "negotiable" rather than invent a number he might be misrepresented by.
 */
export function jobSalaryExpectation(country: string | null): string {
  const c = (country || '').trim().toLowerCase();
  if (c === 'united arab emirates' || c === 'uae') return 'AED 10,000–12,000 per month';
  return 'Negotiable / open to discussion';
}

/** Structured applicant identity for filling application forms. */
export const JOB_APPLICANT = {
  firstName: 'Muhammad Umer',
  lastName: 'Bilal',
  fullName: 'Muhammad Umer Bilal',
  email: CV_HEADER.email,
  phone: CV_HEADER.phone,
  city: 'Dubai',
  country: 'United Arab Emirates',
  nationality: 'Pakistani',
  currentLocation: 'Dubai, United Arab Emirates',
  linkedin: CV_HEADER.linkedin,
  github: CV_HEADER.github,
  yearsExperience: '6',
  /** Forms ask these but a CV never contains them (set from user preferences). */
  noticePeriod: '1 month',
  earliestStart: 'One month from offer',
  /** Safe, truthful default until Umer provides per-market ranges. */
  salaryExpectation: 'Negotiable / open to discussion',
  /** Gender, for demographic form fields. */
  gender: 'Male',
};

/**
 * Umer's fixed answers to the standard screening questions ATS forms gate
 * submission on. Set explicitly by Umer (not inferred), so the auto-filler can
 * complete these choice fields and let clean forms actually submit:
 *   • authorized to work / right to work → YES (works in any country)
 *   • require visa sponsorship           → YES (needs sponsorship)
 *   • willing to relocate                → YES
 *   • gender                             → Male
 *   • race / veteran / disability (EEO)  → prefer not to say (Umer didn't
 *     specify; declining is honest and still lets the form submit)
 */
export const JOB_SCREENING = {
  authorizedToWork: true,
  requiresSponsorship: true,
  willingToRelocate: true,
  gender: 'Male',
};

/** Terse prose profile for Claude prompts (cover letters, form answers). */
export const JOB_OWNER_PROFILE = `
Applicant: Muhammad Umer Bilal — Senior Software Engineer, based in Dubai, UAE (UAE Employment Visa holder), Pakistani national.
- 6 years building production web/mobile systems: Node.js, NestJS, microservices, REST/GraphQL APIs; React.js, Next.js, React Native.
- Databases: PostgreSQL, MongoDB, MySQL, Redis (Sequelize/TypeORM/Prisma). Messaging: Kafka, RabbitMQ, WebSockets.
- Cloud/DevOps: AWS, Docker, CI/CD (Bitbucket Pipelines), Firebase, Nginx, Linux.
- Integrated LLM/RAG features on Azure AI Foundry into production apps.
- MS in Computer Networks & Security, FAST-NUCES (2023).
- Current roles: SoftBuilders (Motifino, MAI HRMS), previously AlphaSquad (Pluckers) and GreenAge (Agronomics).
`.trim();
