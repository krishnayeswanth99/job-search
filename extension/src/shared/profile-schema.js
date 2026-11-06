/*
 * Job Copilot: profile schema.
 * The same JSON shape is used by the extension (chrome.storage) and by the
 * Claude skills (~/.job-search/profile.json), so a profile exported from one
 * can be imported into the other.
 */
(function (root) {
  const JC = (root.JC = root.JC || {});

  const DECLINE = 'Decline to self-identify';

  JC.PROFILE_SECTIONS = [
    {
      id: 'personal',
      title: 'Personal',
      fields: [
        ['firstName', 'First name'],
        ['lastName', 'Last name'],
        ['preferredName', 'Preferred name'],
        ['pronouns', 'Pronouns'],
        ['email', 'Email', 'email'],
        ['phone', 'Phone', 'tel'],
        ['phoneCountryCode', 'Phone country code (e.g. +1)'],
        ['address1', 'Street address'],
        ['address2', 'Address line 2'],
        ['city', 'City'],
        ['state', 'State / province'],
        ['postalCode', 'Postal code'],
        ['country', 'Country'],
      ],
    },
    {
      id: 'links',
      title: 'Links',
      fields: [
        ['linkedin', 'LinkedIn URL', 'url'],
        ['github', 'GitHub URL', 'url'],
        ['portfolio', 'Portfolio URL', 'url'],
        ['website', 'Personal website', 'url'],
        ['twitter', 'X / Twitter URL', 'url'],
      ],
    },
    {
      id: 'work',
      title: 'Work',
      fields: [
        ['currentTitle', 'Current / most recent title'],
        ['currentCompany', 'Current / most recent company'],
        ['yearsExperience', 'Years of experience', 'number'],
        ['noticePeriod', 'Notice period (e.g. 2 weeks)'],
        ['earliestStartDate', 'Earliest start date'],
        // Kept as `desiredSalary` (annual) so profiles from 0.1.0 keep working.
        ['desiredSalary', 'Desired annual salary (plain number, e.g. 150000)'],
        ['desiredHourlyRate', 'Desired hourly rate (plain number, e.g. 75)'],
        ['salaryCurrency', 'Salary currency (e.g. USD)'],
      ],
    },
    {
      id: 'education',
      title: 'Education (highest)',
      fields: [
        ['school', 'School / university'],
        ['degree', 'Degree (e.g. Bachelor of Science)'],
        ['fieldOfStudy', 'Field of study'],
        ['graduationYear', 'Graduation year', 'number'],
        ['gpa', 'GPA'],
      ],
    },
    {
      id: 'authorization',
      title: 'Work authorization & logistics',
      fields: [
        ['authorizedToWork', 'Legally authorized to work in the job country? (Yes/No)'],
        ['requiresSponsorship', 'Will you require visa sponsorship? (Yes/No)'],
        ['willingToRelocate', 'Willing to relocate? (Yes/No)'],
        ['remotePreference', 'Work arrangement preference (Remote/Hybrid/Onsite)'],
        ['over18', 'Are you 18 or older? (Yes/No)'],
        ['citizenship', 'Citizenship'],
        ['securityClearance', 'Security clearance (or None)'],
      ],
    },
    {
      id: 'eeo',
      title: 'Voluntary self-identification (EEO)',
      hint: `Leave as "${DECLINE}" unless you want to answer.`,
      fields: [
        ['gender', 'Gender'],
        ['race', 'Race / ethnicity'],
        ['hispanicLatino', 'Hispanic or Latino?'],
        ['veteran', 'Veteran status'],
        ['disability', 'Disability status'],
        ['sexualOrientation', 'Sexual orientation'],
      ],
    },
  ];

  JC.emptyProfile = function emptyProfile() {
    const p = { version: 1 };
    for (const s of JC.PROFILE_SECTIONS) {
      p[s.id] = {};
      for (const [key] of s.fields) p[s.id][key] = '';
    }
    for (const key of Object.keys(p.eeo)) p.eeo[key] = DECLINE;
    p.howDidYouHear = 'LinkedIn';
    p.summary = '';
    /** Saved answers to custom questions: [{ question, answer }]. */
    p.answers = [];
    return p;
  };

  /** Deep-merge `src` onto a fresh empty profile so missing keys get defaults. */
  JC.normalizeProfile = function normalizeProfile(src) {
    const base = JC.emptyProfile();
    if (!src || typeof src !== 'object') return base;
    for (const k of Object.keys(src)) {
      const v = src[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        base[k] = Object.assign(base[k], v);
      } else if (v !== undefined) {
        base[k] = v;
      }
    }
    if (!Array.isArray(base.answers)) base.answers = [];
    return base;
  };

  JC.DECLINE = DECLINE;

  if (typeof module !== 'undefined' && module.exports) module.exports = JC;
})(typeof globalThis !== 'undefined' ? globalThis : self);
