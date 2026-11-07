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
  assert.equal(key({ automationId: 'phone-device-type' }), null);
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
