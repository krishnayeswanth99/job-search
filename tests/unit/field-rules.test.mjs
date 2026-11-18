import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadJC } from './load.mjs';

const JC = loadJC();
const { classifyField, chooseOption, valueForKey, matchSavedAnswer } = JC.rules;
const key = (f) => (classifyField(f) || {}).key || null;

test('classifies common labels', () => {
  const cases = [
    [{ label: 'First Name *' }, 'firstName'],
    [{ label: 'Last name' }, 'lastName'],
    [{ label: 'Full name✱' }, 'fullName'],
    [{ label: 'Name' }, 'fullName'],
    [{ label: 'Email address' }, 'email'],
    [{ label: 'Phone' }, 'phone'],
    [{ label: 'LinkedIn Profile' }, 'linkedin'],
    [{ label: 'GitHub URL' }, 'github'],
    [{ label: 'Portfolio URL' }, 'portfolio'],
    [{ label: 'Website' }, 'website'],
    [{ label: 'Current company' }, 'currentCompany'],
    [{ label: 'Preferred First Name' }, 'preferredName'],
    [{ label: 'Zip code' }, 'postalCode'],
    [{ label: 'Country' }, 'country'],
    [{ label: 'Location' }, 'location'],
    [{ label: 'Resume/CV', type: 'file' }, 'resume'],
    [{ label: 'Cover Letter', type: 'file' }, 'coverLetter'],
    [{ label: 'Gender' }, 'gender'],
    [{ label: 'Are you Hispanic/Latino?' }, 'hispanicLatino'],
    [{ label: 'Veteran Status' }, 'veteran'],
    [{ label: 'Disability Status' }, 'disability'],
  ];
  for (const [f, want] of cases) assert.equal(key(f), want, JSON.stringify(f));
});

test('long questions only match question rules', () => {
  assert.equal(key({ label: 'Are you legally authorized to work in the United States for any employer without restriction?' }), 'authorizedToWork');
  assert.equal(key({ label: 'Will you now or in the future require sponsorship for employment visa status (e.g. H-1B visa status)?' }), 'requiresSponsorship');
  assert.equal(key({ label: 'How did you hear about this job?' }), 'howDidYouHear');
  // A long free-text question that mentions "company" must not be treated as current company.
  assert.equal(key({ label: 'Tell us about a project at your current company that you are most proud of and why it mattered', type: 'textarea' }), null);
});

test('uses attributes and autocomplete', () => {
  assert.equal(key({ name: 'job_application[first_name]' }), 'firstName');
  assert.equal(key({ automationId: 'legalNameSection_lastName' }), 'lastName');
  assert.equal(key({ automationId: 'phone-device-type' }), 'phoneType');
  assert.equal(key({ label: 'Phone Type' }), 'phoneType');
  assert.equal(JC.rules.valueForKey(JC.normalizeProfile({}), 'phoneType'), 'Mobile');
  assert.equal(key({ label: 'Previous HERE Employee ID' }), 'formerEmployeeId');
  assert.equal(JC.rules.valueForKey(JC.normalizeProfile({}), 'formerEmployeeId'), '');
  assert.equal(key({ label: 'Phone' }), 'phone');
  assert.equal(key({ automationId: 'countryPhoneCode' }), 'phoneCountryCode');
  assert.equal(key({ autocomplete: 'given-name', label: 'Something odd' }), 'firstName');
  assert.equal(key({ type: 'password', label: 'Password' }), null);
  // Seen live on Lever: must not be filled with the candidate's name.
  assert.equal(key({ label: 'Name Pronunciation | How do you pronounce your name?' }), null);
});

test('consent checkboxes are flagged, never mapped to profile data', () => {
  assert.equal(key({ label: 'I agree to the Privacy Policy', type: 'checkbox' }), 'consent');
});

test('chooseOption handles yes/no, decline, countries, ranges', () => {
  const yn = [{ text: 'Select...' }, { text: 'Yes' }, { text: 'No' }];
  assert.equal(chooseOption(yn, 'Yes'), 1);
  assert.equal(chooseOption(yn, 'no'), 2);
  const vet = [{ text: 'I am a protected veteran' }, { text: 'I am not a protected veteran' }, { text: "I don't wish to answer" }];
  assert.equal(chooseOption(vet, 'No'), 1);
  assert.equal(chooseOption(vet, 'Yes'), 0);
  assert.equal(chooseOption(vet, 'Decline to self-identify'), 2);
  const gender = [{ text: 'Female' }, { text: 'Male' }, { text: 'Decline To Self Identify' }];
  assert.equal(chooseOption(gender, 'Male'), 1);
  assert.equal(chooseOption(gender, 'Decline to self-identify'), 2);
  const countries = [{ text: 'Canada' }, { text: 'United States of America' }, { text: 'India' }];
  assert.equal(chooseOption(countries, 'USA'), 1);
  assert.equal(chooseOption(countries, 'United States'), 1);
  const yrs = [{ text: '0-2 years' }, { text: '3-5 years' }, { text: '6-9 years' }, { text: '10+ years' }];
  assert.equal(chooseOption(yrs, '7'), 2);
  assert.equal(chooseOption(yrs, '12'), 3);
  assert.equal(chooseOption(yn, ''), -1);
  assert.equal(chooseOption([{ text: 'Apple' }, { text: 'Banana' }], 'Cherry'), -1);
});

test('valueForKey composes values', () => {
  const p = JC.normalizeProfile({ personal: { firstName: 'Ada', lastName: 'Lovelace', city: 'London', country: 'United Kingdom' }, howDidYouHear: 'LinkedIn' });
  assert.equal(valueForKey(p, 'fullName'), 'Ada Lovelace');
  assert.equal(valueForKey(p, 'location'), 'London, United Kingdom');
  assert.equal(valueForKey(p, 'howDidYouHear'), 'LinkedIn');
  assert.equal(valueForKey(p, 'gender'), 'Decline to self-identify');
  assert.equal(valueForKey(p, 'consent'), '');
});

test('matchSavedAnswer finds similar questions', () => {
  const answers = [{ question: 'Why do you want to work here?', answer: 'Mission.' }, { question: 'Are you willing to work weekends', answer: 'Yes' }];
  assert.equal(matchSavedAnswer('Why do you want to work here?*', answers), 'Mission.');
  assert.equal(matchSavedAnswer('Are you willing to work on weekends?', answers), 'Yes');
  assert.equal(matchSavedAnswer('What is your favorite color?', answers), null);
});

test('trust and portal helpers', () => {
  assert.equal(JC.portalForHost('job-boards.greenhouse.io').id, 'greenhouse');
  assert.equal(JC.portalForHost('acme.wd5.myworkdayjobs.com').id, 'workday');
  assert.equal(JC.portalForHost('www.linkedin.com').id, 'linkedin');
  assert.equal(JC.portalForHost('example.com'), null);
  assert.equal(JC.isTrustedHost('jobs.lever.co'), true);
  assert.equal(JC.isTrustedHost('evil-lever.co'), false);
  assert.equal(JC.isTrustedHost('careers.acme.com', ['acme.com']), true);
});

test('pay questions are split by period', () => {
  const pay = (f) => {
    const c = classifyField(f) || {};
    return [c.key, c.period].join(':');
  };
  assert.equal(pay({ label: 'Desired salary' }), 'desiredSalary:annual');
  assert.equal(pay({ label: 'What are your salary expectations for this role?' }), 'desiredSalary:annual');
  assert.equal(pay({ label: 'Expected CTC (LPA)' }), 'desiredSalary:annual');
  assert.equal(pay({ label: 'Desired annual compensation' }), 'desiredSalary:annual');
  assert.equal(pay({ label: 'Expected hourly rate' }), 'desiredHourlyRate:hourly');
  assert.equal(pay({ label: 'Desired pay rate' }), 'desiredHourlyRate:hourly');
  assert.equal(pay({ label: 'Compensation expectations', placeholder: 'e.g. $60/hr' }), 'desiredHourlyRate:hourly');
  assert.equal(pay({ label: 'Desired compensation', type: 'select', optionsText: '$40-$50/hr | $50-$60/hr' }), 'desiredHourlyRate:hourly');
  assert.equal(pay({ label: 'Monthly salary expectation' }), 'desiredPay:monthly');
  assert.equal(pay({ label: 'Day rate' }), 'desiredPay:daily');
  assert.equal(pay({ label: 'What is your desired pay?' }), 'desiredPay:unknown');
  assert.equal(pay({ label: 'Compensation expectations' }), 'desiredPay:unknown');
  // Current pay must never receive the desired figure.
  assert.equal(pay({ label: 'What is your current salary?' }), 'currentPay:');
  assert.equal(pay({ label: 'Current CTC' }), 'currentPay:');
  assert.equal(pay({ label: 'Previous hourly rate' }), 'currentPay:');
  assert.equal(valueForKey(JC.normalizeProfile({ work: { desiredSalary: '150000' } }), 'currentPay'), '');
});

test('pay values are never guessed or converted', () => {
  const both = JC.normalizeProfile({ work: { desiredSalary: '150000', desiredHourlyRate: '75' } });
  assert.equal(valueForKey(both, 'desiredSalary'), '150000');
  assert.equal(valueForKey(both, 'desiredHourlyRate'), '75');
  assert.equal(valueForKey(both, 'desiredPay'), '');
  const annualOnly = JC.normalizeProfile({ work: { desiredSalary: '150000' } });
  assert.equal(valueForKey(annualOnly, 'desiredHourlyRate'), '');
  assert.match(JC.rules.emptyReason('desiredHourlyRate', 'hourly', annualOnly), /only has an annual salary/);
  assert.match(JC.rules.emptyReason('desiredPay', 'unknown', both), /hourly or annual/);
  assert.match(JC.rules.emptyReason('desiredPay', 'monthly', both), /monthly/);
});

test('amount parsing', () => {
  const { amounts, parseAmount, toNumberValue } = JC.rules;
  assert.deepEqual([...amounts('$100k – $150,000')], [100000, 150000]);
  assert.deepEqual([...amounts('0-2 years')], [0, 2]);
  assert.equal(parseAmount('150000'), 150000);
  assert.equal(parseAmount('$150,000'), 150000);
  assert.equal(parseAmount('150k'), 150000);
  assert.equal(parseAmount('USD 75/hr'), 75);
  assert.equal(parseAmount('18 LPA'), 1800000);
  assert.equal(parseAmount('140k-160k'), null);
  assert.equal(parseAmount('negotiable'), null);
  assert.equal(toNumberValue('$150,000'), '150000');
  assert.equal(toNumberValue('140-160k'), null);
});

test('salary range dropdowns', () => {
  const opts = [{ text: 'Select...' }, { text: 'Under $100,000' }, { text: '$100k - $150k' }, { text: '$150,001 - $200,000' }, { text: '$200,000+' }];
  assert.equal(chooseOption(opts, '90000'), 1);
  assert.equal(chooseOption(opts, '150000'), 2);
  assert.equal(chooseOption(opts, '$175,000'), 3);
  assert.equal(chooseOption(opts, '250k'), 4);
  const hourly = [{ text: '$40-$50/hr' }, { text: '$50-$75/hr' }, { text: '$75+/hr' }];
  assert.equal(chooseOption(hourly, '60'), 1);
});

test('iCIMS profile labels: Source, Time Zone, sign-off', () => {
  assert.equal(key({ label: 'Source' }), 'howDidYouHear');
  assert.equal(key({ label: 'Time Zone' }), 'timeZone');
  assert.equal(key({ label: 'Candidate Sign-off on Information Provided' }), 'consent');
  const c = [...JC.rules.timeZoneCandidates('America/New_York', 300)];
  assert.ok(c.includes('Eastern Time') && c.includes('GMT-05:00') && c.includes('New York'), JSON.stringify(c));
  const opts = [{ text: '(GMT-08:00) Pacific Time' }, { text: '(GMT-05:00) Eastern Time (US & Canada)' }];
  assert.equal(c.map((d) => JC.rules.chooseOption(opts, d)).find((i) => i >= 0), 1);
});

test('sameValue: formatting differences are not conflicts', () => {
  const same = JC.rules.sameValue;
  assert.ok(same('phone', '(415) 555-0134', '+1 415-555-0134'));
  assert.ok(!same('phone', '(415) 555-0199', '+1 415-555-0134'));
  assert.ok(same('linkedin', 'linkedin.com/in/ada/', 'https://www.linkedin.com/in/ada'));
  assert.ok(same('email', 'Ada@Example.com', 'ada@example.com'));
  assert.ok(same('firstName', 'ADA', 'Ada'));
  assert.ok(!same('firstName', 'Ava', 'Ada'));
  assert.ok(same('location', 'London, England, United Kingdom', 'London, United Kingdom'));
  assert.ok(same('fullName', 'Ada King Lovelace', 'Ada Lovelace'));
  assert.ok(!same('currentTitle', 'Engineer II', 'Senior Engineer'));
});

test('split date boxes: signature date is today, other dates are left alone', () => {
  const wd = (part) => ({ label: part, id: `selfIdentifiedDisabilityData--dateSignedOn-dateSection${part}-input`, type: 'text' });
  assert.equal(key(wd('Month')), 'todayMonth');
  assert.equal(key(wd('Day')), 'todayDay');
  assert.equal(key(wd('Year')), 'todayYear');
  assert.equal(key({ label: 'Signature Date' }), 'todayDate');
  assert.equal(key({ label: 'Signature' }), 'consent');
  assert.equal(key({ label: 'Month', id: 'dateOfBirth-dateSectionMonth-input' }), null);
  assert.equal(key({ label: 'Year', id: 'education-graduationDate-dateSectionYear-input' }), 'graduationYear');
  const d = new Date(2026, 10, 7);
  assert.equal(valueForKey({}, 'todayDate', d), '11/07/2026');
  assert.equal(valueForKey({}, 'todayMonth', d), '11');
  assert.equal(valueForKey({}, 'todayDay', d), '07');
  assert.equal(valueForKey({}, 'todayYear', d), '2026');
});

test('resume source choices pick uploading a file', () => {
  const opts = (...t) => t.map((x) => ({ text: x, value: x }));
  assert.equal(key({ label: 'Resume Upload Selection', type: 'radio' }), 'resumeSource');
  assert.equal(key({ label: 'Select the resume file to upload', type: 'radio' }), 'resumeSource');
  assert.equal(key({ label: 'Apply with', type: 'radio', optionsText: 'LinkedIn | Upload resume | Manually' }), 'resumeSource');
  assert.equal(JC.rules.chooseResumeSource(opts('Use my LinkedIn profile', 'Upload a resume', 'No thanks, I will fill out the online submission manually')), 1);
  assert.equal(JC.rules.chooseResumeSource(opts('Dropbox', 'Google Drive', 'My computer')), 2);
  assert.equal(JC.rules.chooseResumeSource(opts('LinkedIn', 'Manually')), -1);
});

test('experience yes/no questions: Yes only with evidence in the resume or skills', () => {
  const resume = 'Built analytics services in Python and Spark on AWS.';
  const ev = (q, skills = '') => JC.rules.evidenceAnswer(q, resume, skills);
  assert.equal(ev('Have you built and supported production software using Python or Java?'), 'Yes');
  assert.equal(ev('Do you have experience with AWS and Kubernetes?'), null);
  assert.equal(ev('Do you have experience with AWS and Spark?'), 'Yes');
  assert.equal(ev('Do you have experience with JavaScript?'), null); // "Java" is not JavaScript
  assert.equal(ev('Do you have experience with Tableau?', 'SQL, Tableau'), 'Yes');
  assert.equal(ev('Are you authorized to work in the US?'), null);
  assert.equal(ev('Have you previously worked for Python Software Foundation?'), null);
});

test('"have you worked at X" is answered from the resume; shared phone codes pick your country', () => {
  const resume = 'Experience\nData Scientist, Applied Materials Inc., Santa Clara, CA\n' + 'Built models. '.repeat(40);
  const q = 'Have you ever worked at Applied Materials as a regular employee, contingent worker, intern, etc.?';
  assert.equal(JC.rules.formerEmployerOf(q), 'Applied Materials');
  assert.equal(JC.rules.formerEmployerAnswer(q, resume), 'Yes');
  assert.equal(JC.rules.formerEmployerAnswer('Are you a current or former employee of Google?', resume), 'No');
  assert.equal(JC.rules.formerEmployerAnswer('Have you ever worked for this company?', resume), null);
  assert.equal(JC.rules.formerEmployerAnswer('Have you worked with Python?', resume), null);
  assert.equal(JC.rules.formerEmployerAnswer(q, 'short'), null); // no real resume: leave it to you
  const o = (...t) => t.map((x) => ({ text: x, value: x }));
  const codes = o('Canada (+1)', 'United States of America (+1)', 'India (+91)', 'Jersey (+44)', 'United Kingdom (+44)');
  assert.equal(JC.rules.choosePhoneCode(codes, '+1', 'United States'), 1);
  assert.equal(JC.rules.choosePhoneCode(codes, '+1', 'Canada'), 0);
  assert.equal(JC.rules.choosePhoneCode(codes, '+1', ''), 1);
  assert.equal(JC.rules.choosePhoneCode(codes, '+44', 'India'), 4); // UK phone, living in India
  assert.equal(JC.rules.choosePhoneCode(codes, '+91', 'United States'), 2);
  assert.equal(valueForKey({ personal: { phone: '+91 98765 43210', country: 'United States' } }, 'phoneCountryCode'), '+91');
  assert.equal(valueForKey({ personal: { phone: '555 0100', country: 'Canada' } }, 'phoneCountryCode'), '+1');
});

test('"Country/Region of Residence" is the country; a city never picks a same-named country', () => {
  assert.equal(key({ label: 'Country/Region of Residence', type: 'select' }), 'country');
  assert.equal(key({ label: 'State/Region', type: 'select' }), 'state');
  const o = [{ text: 'Jersey', value: 'JE' }, { text: 'United States of America', value: 'US' }];
  assert.equal(chooseOption(o, 'Jersey City'), -1);
  assert.equal(chooseOption(o, 'United States'), 1);
  assert.equal(chooseOption([{ text: 'New Jersey', value: 'NJ' }, { text: 'Jersey', value: 'JE' }], 'New Jersey'), 0);
});

test('degree candidates match how dropdowns name degrees', () => {
  const c = (d) => JC.rules.degreeCandidates(d);
  assert.ok(c('M.S.').includes("Master's Degree"));
  assert.ok(c('Master of Science').includes("Master's Degree"));
  assert.ok(c('B.Tech').includes("Bachelor's Degree"));
  assert.ok(c('B.S.').includes('Bachelor of Science'));
  assert.ok(c('PhD').includes('Doctorate'));
  assert.ok(c('MBA').includes('Master of Business Administration'));
  assert.equal(c('B.S.')[0], 'B.S.');
});

test('diversity questions: transgender and "ethnicities" are recognised; empty answers decline', () => {
  assert.equal(key({ label: 'Are you a person of transgender experience?', type: 'radio' }), 'transgender');
  assert.equal(key({ label: 'Please select up to 2 ethnicities that you most closely identify with.', type: 'checkbox' }), 'race');
  const p = JC.normalizeProfile({ eeo: { sexualOrientation: '' } });
  assert.equal(valueForKey(p, 'sexualOrientation'), 'Decline to self-identify');
  assert.equal(valueForKey(p, 'transgender'), 'Decline to self-identify');
});

test('languages and Workday-style degree / level wording', () => {
  assert.equal(JSON.stringify(JC.rules.parseLanguages('English (native), Hindi (fluent), Telugu').map((l) => [l.language, l.native, l.level])), JSON.stringify([['English', true, 'native'], ['Hindi', false, 'fluent'], ['Telugu', false, '']]));
  const o = (...t) => t.map((x) => ({ text: x, value: x }));
  const pick = (opts, list) => list.map((d) => chooseOption(opts, d)).find((i) => i >= 0);
  const wdDeg = o('Select One', 'GED', 'High School', 'Associates', 'Bachelors', 'Masters', 'Doctorate');
  assert.equal(wdDeg[pick(wdDeg, JC.rules.degreeCandidates('Master of Science'))].text, 'Masters');
  assert.equal(wdDeg[pick(wdDeg, JC.rules.degreeCandidates('B.Tech'))].text, 'Bachelors');
  const lv = o('Select One', '1 - Beginner', '2 - Classroom Study', '3 - Intermediate', '4 - Advanced', '5 - Fluent');
  assert.equal(lv[pick(lv, JC.rules.levelCandidates('native'))].text, '5 - Fluent');
  assert.equal(lv[pick(lv, JC.rules.levelCandidates('intermediate'))].text, '3 - Intermediate');
});
