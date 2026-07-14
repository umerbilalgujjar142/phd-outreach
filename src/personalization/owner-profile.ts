/**
 * Umer's fixed research profile (PROJECT.md Section 1), injected into every
 * personalization prompt so Claude can connect his background to the
 * professor's work. Kept terse on purpose — the snippet must stay short.
 */
export const OWNER_PROFILE = `
Applicant: Muhammad Umer Bilal.
- MS in Computer Networks & Security, NUCES-FAST Islamabad (2021-2023).
- Master's thesis (ML-based network security): "Dynamic Allocation of Window
  Size for Detection of Low-Rate DDoS Attacks" - used RNN, LSTM, MLP, Random
  Forest and decision trees on the UNSW-NB15 dataset to detect low-rate DDoS.
- 6+ years professional software engineering (Node.js, NestJS, full-stack).
- Actively building offensive-security / AppSec skills (PortSwigger Web
  Security Academy, Burp Suite); targeting eJPT then OSCP.
- Seeking a funded PhD; strong interests: network security, intrusion/anomaly
  detection, machine learning for security, and application security.
`.trim();
