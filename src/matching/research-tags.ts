export type Tier = 1 | 2;

/**
 * Discipline gate (precision fix). EURAXESS mixes every faculty, so a stray
 * keyword in an 8000-char body ("network", "privacy" from the GDPR notice)
 * used to match mechanical/civil/materials professors. We now require the
 * posting's DISCIPLINE (research field + title) to be computing-relevant, OR
 * carry an unambiguous security signal, before any tag counts.
 */
export const IN_DOMAIN_RE =
  /(computer science|computer engineering|computing|informatics|information technology|\bict\b|computer networks?|networking|telecommunication|artificial intelligence|machine learning|deep learning|data science|cyber\s?security|software engineering|electrical engineering and computer)/i;

/** Clearly non-CS disciplines — excluded unless a strong security term rescues them. */
export const OUT_DOMAIN_RE =
  /(mechanical engineering|civil engineering|materials? science|chemistry|chemical engineering|biolog|biomedical|biotechnolog|life science|\bphysics\b|astronom|aerospace|aeronautic|automotive|mechatronic|nanotechnolog|photonic|\boptics\b|polymer|thermodynam|fluid dynamic|structural engineering|geotechn|environmental science|environmental engineering|geolog|geograph|hydrolog|agricultur|food science|veterinary|\bmedicine\b|medical|clinical|pharmaceutic|pharmac|nursing|dentist|neuroscience|economics|\bfinance\b|accounting|marketing|business administration|management studies|\blaw\b|legal studies|psycholog|sociolog|anthropolog|philosoph|linguistic|literature|\bhistory\b|architecture|urban planning|political science|electrical engineering|electronic engineering|power systems|power electronics|energy systems|renewable energy|mining|petroleum)/i;

/** Unambiguous security/ML-security terms strong enough to rescue an out-of-domain field. */
export const STRONG_SECURITY_RE =
  /(cyber\s?security|information security|\binfosec\b|network security|secure networking|intrusion detection|anomaly detection|\bddos\b|denial[- ]of[- ]service|malware|ransomware|botnet|cryptograph|cryptolog|post[- ]quantum|penetration testing|pentest|offensive security|red team|ethical hack|digital forensic|incident response|threat intelligence|threat detection|security operations|application security|\bappsec\b|web security|software security|cloud security|iot security|embedded security|hardware security|side[- ]channel|cyber[- ]physical|privacy[- ]preserving|differential privacy|adversarial (machine learning|ml|example|attack)|\bai security\b|\bml security\b|fuzzing|vulnerability (research|discovery)|exploit development|hardware trojan|trusted execution|confidential computing|\bscada\b|industrial control system|homomorphic encryption|federated learning|medical (device|implant) security|health(care)?[- ]?data (security|privacy|protection)|patient (data )?(privacy|security)|(security|privacy) (of|in|for) (medical|health|healthcare|clinical|e[- ]?health))/i;

/**
 * Tags whose patterns frequently match site boilerplate (EURAXESS GDPR/cookie
 * notice) rather than the professor's actual research. These only count when
 * they appear in the high-signal zone (title + research field), never when the
 * hit is buried in the body text.
 */
export const BOILERPLATE_PRONE_TAGS = new Set<string>([
  'Privacy engineering / data privacy',
]);

// ── Position-level gate (PhD-entry only) ──────────────────────────────
// The applicant is seeking a PhD (has an MS), so positions that REQUIRE a PhD
// (postdoc, professorship, senior roles) are not a fit and are excluded.

/** Title clearly signals a PhD-entry position → keep regardless of the below. */
export const PHD_TITLE_RE =
  /(ph\.?\s?d|doctoral|doctorate|doktorand|promotie|pre[- ]?doc|early[- ]stage researcher|\besr\b|first stage researcher|\br1\b)/i;

/** Title signals a role that needs a completed PhD (postdoc/faculty/senior). */
export const NON_PHD_TITLE_RE =
  /(post[- ]?doc|postdoctoral|assistant professor|associate professor|full professor|\bprofessor\b|professorship|tenure[- ]track|habilitation|senior (researcher|scientist|lecturer|fellow)|research fellow|\blecturer\b|\breader\b|group leader|principal investigator)/i;

/** Requirements text that demands an already-completed PhD → not a fit. */
export const REQUIRES_PHD_RE =
  /((completed|finished|hold|holds|holding|awarded|obtained|earned|have|has|with)\s+(a\s+|an\s+|your\s+)?(ph\.?\s?d|doctorate|doctoral degree))|((ph\.?\s?d|doctorate)\s+(is\s+)?(required|mandatory|degree is required))|(must hold a ph\.?\s?d)/i;

export interface TagRule {
  tag: string;
  tier: Tier;
  patterns: RegExp[];
}

export const TAG_RULES: TagRule[] = [
  // ── Tier 1 (core) ──────────────────────────────────────────
  {
    tag: 'Cybersecurity (general)',
    tier: 1,
    patterns: [/cyber\s?security/i, /information security/i, /\binfosec\b/i],
  },
  {
    tag: 'Network security',
    tier: 1,
    patterns: [
      /network security/i,
      /secure networking/i,
      /network defen[cs]e/i,
    ],
  },
  {
    tag: 'Intrusion detection / anomaly detection',
    tier: 1,
    patterns: [
      /intrusion detection/i,
      /\bids\b/i,
      /anomaly detection/i,
      /\bddos\b/i,
      /denial[- ]of[- ]service/i,
    ],
  },
  {
    tag: 'Application security (AppSec)',
    tier: 1,
    patterns: [
      /application security/i,
      /\bappsec\b/i,
      /web security/i,
      /software security/i,
    ],
  },
  {
    tag: 'Cloud security',
    tier: 1,
    patterns: [
      /cloud security/i,
      /container security/i,
      /kubernetes security/i,
    ],
  },
  {
    tag: 'Machine learning / AI',
    tier: 1,
    patterns: [
      /machine learning/i,
      /deep learning/i,
      /artificial intelligence/i,
      /neural network/i,
      /\bLSTM\b/i,
      /\bRNN\b/i,
      /reinforcement learning/i,
    ],
  },
  {
    tag: 'Malware analysis',
    tier: 1,
    patterns: [/malware/i, /ransomware/i, /reverse engineering/i, /botnet/i],
  },
  {
    tag: 'Cryptography',
    tier: 1,
    patterns: [
      /cryptograph/i,
      /cryptolog/i,
      /\bencryption\b/i,
      /post[- ]quantum/i,
    ],
  },
  {
    tag: 'IoT security',
    tier: 1,
    patterns: [
      /iot security/i,
      /internet of things/i,
      /embedded security/i,
      /cyber[- ]physical/i,
    ],
  },
  {
    tag: 'Digital forensics',
    tier: 1,
    patterns: [/digital forensic/i, /forensic/i, /incident response/i],
  },
  {
    tag: 'Penetration testing / offensive security',
    tier: 1,
    patterns: [
      /penetration testing/i,
      /pentest/i,
      /offensive security/i,
      /red team/i,
      /ethical hack/i,
    ],
  },
  {
    tag: 'Security operations / threat intelligence',
    tier: 1,
    patterns: [
      /security operations/i,
      /threat intelligence/i,
      /\bSOC\b/i,
      /threat detection/i,
      /human factors in security/i,
    ],
  },
  {
    tag: 'Privacy engineering / data privacy',
    tier: 1,
    patterns: [
      /data privacy/i,
      /privacy[- ]preserving/i,
      /privacy engineering/i,
      /differential privacy/i,
      /\bgdpr\b/i,
    ],
  },
  {
    tag: 'Distributed systems security',
    tier: 1,
    patterns: [
      /distributed systems? security/i,
      /consensus protocol/i,
      /byzantine/i,
    ],
  },
  {
    tag: 'DevSecOps',
    tier: 1,
    patterns: [
      /devsecops/i,
      /secure software development/i,
      /software supply chain/i,
    ],
  },
  {
    tag: 'Adversarial ML / AI security',
    tier: 1,
    patterns: [
      /adversarial (machine learning|ml|example|attack|robustness|perturbation)/i,
      /\bai security\b/i,
      /\bml security\b/i,
      /machine learning security/i,
      /secure (machine learning|deep learning|ai)\b/i,
      /(data|model) poisoning/i,
      /model (extraction|inversion|stealing)/i,
      /backdoor (attack|in (a )?(neural|deep|machine))/i,
      /trustworthy (ai|machine learning|ml)/i,
      /robustness (of |in )?(machine learning|deep learning|neural)/i,
    ],
  },
  {
    tag: 'Hardware security',
    tier: 1,
    patterns: [
      /hardware security/i,
      /hardware trojan/i,
      /side[- ]channel/i,
      /fault (injection|attack)/i,
      /power analysis attack/i,
      /physical(ly)? unclonable|\bPUF\b/i,
      /microarchitectural (attack|security)/i,
      /rowhammer|spectre|meltdown/i,
      /trusted execution|secure enclave|\bTEE\b|intel sgx|trustzone/i,
      /confidential computing/i,
    ],
  },
  {
    tag: 'Vulnerability research / fuzzing',
    tier: 1,
    patterns: [
      /vulnerability (research|discovery|detection|assessment|analysis|management)/i,
      /(software|system|memory|web|binary|kernel) vulnerabilit/i,
      /\bfuzzing\b/i,
      /\bfuzzer/i,
      /fuzz[- ]?testing/i,
      /exploit (development|generation|mitigation)/i,
      /binary analysis/i,
      /symbolic execution/i,
      /memory (safety|corruption)/i,
      /\bCVE\b/i,
      /bug (hunting|bounty)/i,
    ],
  },
  {
    tag: 'Authentication / identity & access management',
    tier: 1,
    patterns: [
      /identity (and )?(access )?management/i,
      /\bIAM\b/i,
      /access control/i,
      /single sign[- ]?on|\bSSO\b/i,
      /multi[- ]?factor authentication|\bMFA\b|two[- ]?factor/i,
      /biometric (authentication|security|recognition)/i,
      /public key infrastructure|\bPKI\b/i,
      /passwordless|passkey|\bFIDO\b|\bOAuth\b|OpenID/i,
      /authentication protocol|authorization (framework|policy|protocol)/i,
    ],
  },
  {
    tag: 'Trusted execution / confidential computing',
    tier: 1,
    patterns: [
      /trusted execution|\bTEE\b/i,
      /secure enclave|intel sgx|\bSGX\b|trustzone|\bSEV\b/i,
      /confidential computing/i,
      /remote attestation|trusted computing/i,
    ],
  },
  {
    tag: 'ICS / SCADA / OT security',
    tier: 1,
    patterns: [
      /industrial control system/i,
      /\bSCADA\b/i,
      /operational technology (security)?|\bOT[- ]security\b/i,
      /critical infrastructure (security|protection)/i,
      /\bICS\b[- ]?(security|systems?)/i,
      /programmable logic controller/i,
    ],
  },
  {
    tag: 'Federated learning / privacy-preserving ML',
    tier: 1,
    patterns: [
      /federated learning/i,
      /privacy[- ]preserving (machine learning|ml|deep learning|computation|data|analytics)/i,
      /secure (multi[- ]party computation|aggregation)/i,
      /multi[- ]party computation/i,
      /homomorphic encryption/i,
      /split learning/i,
    ],
  },
  {
    tag: 'Formal methods / protocol verification for security',
    tier: 1,
    patterns: [
      /formal (verification|methods|analysis) (of |for )?(security|cryptographic|protocol)/i,
      /(security|cryptographic|network) protocol (verification|analysis|design)/i,
      /protocol verification/i,
      /verified (cryptography|security|protocols?)/i,
      /formal security (proof|model|analysis)/i,
      /model checking (of )?(security|protocol)/i,
    ],
  },
  // ── Tier 2 (adjacent, lower priority) ──────────────────────
  {
    tag: 'Data science / big data',
    tier: 2,
    patterns: [/data science/i, /big data/i, /data analytics/i, /data mining/i],
  },
  {
    tag: 'Software engineering (security/reliability)',
    tier: 2,
    patterns: [
      /software engineering/i,
      /software reliability/i,
      /formal verification/i,
      /software testing/i,
    ],
  },
  {
    tag: 'Blockchain security',
    tier: 2,
    patterns: [/blockchain/i, /distributed ledger/i, /smart contract/i],
  },
  {
    tag: 'Wireless/mobile network security',
    tier: 2,
    patterns: [
      /wireless security/i,
      /\b5g\b/i,
      /mobile network/i,
      /wireless network/i,
    ],
  },
];
