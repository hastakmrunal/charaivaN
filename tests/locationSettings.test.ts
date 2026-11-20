import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findCountryByNameOrCode,
  getWorldwideCountries,
  searchWorldwideCountries,
} from '../src/data/isoCountries';
import {
  getStatesForCountry,
  searchWorldwideSettlements,
} from '../server/locationsService';

test('worldwide country list includes ~250 ISO 3166 countries and supports aliases & codes', () => {
  const all = getWorldwideCountries('en');
  assert.ok(all.length >= 240, `Expected >= 240 ISO countries, got ${all.length}`);

  const ukMatches = searchWorldwideCountries('UK', 'en');
  assert.ok(ukMatches.some((c) => c.code === 'GB'));

  const uaeMatches = searchWorldwideCountries('UAE', 'en');
  assert.ok(uaeMatches.some((c) => c.code === 'AE'));

  const bharatMatches = searchWorldwideCountries('Bharat', 'en');
  assert.equal(bharatMatches[0]?.code, 'IN');

  const diacriticMatches = searchWorldwideCountries('Cote', 'en');
  assert.ok(diacriticMatches.some((c) => c.code === 'CI'));

  const invalid = searchWorldwideCountries('AtlantisXYZ', 'en');
  assert.equal(invalid.length, 0);

  const byName = findCountryByNameOrCode('Japan', 'en');
  assert.equal(byName?.code, 'JP');
});

test('worldwide country search localizes names with Intl.DisplayNames across languages', () => {
  const arGermany = searchWorldwideCountries('Germany', 'ar');
  assert.ok(arGermany.some((c) => c.code === 'DE'));
  const deEntry = arGermany.find((c) => c.code === 'DE');
  assert.ok(deEntry?.localizedName && deEntry.localizedName.length > 0);

  const frMatches = searchWorldwideCountries('Allemagne', 'fr');
  assert.ok(frMatches.some((c) => c.code === 'DE'));
});

test('getStatesForCountry strictly scopes subdivisions to the selected country and handles empty-state territories', () => {
  const indiaStates = getStatesForCountry('IN', 'Maha');
  assert.equal(indiaStates.hasStates, true);
  assert.ok(indiaStates.states.some((s) => s.code === 'MH' && s.name === 'Maharashtra'));
  assert.ok(!indiaStates.states.some((s) => s.name === 'California'));

  const vaticanStates = getStatesForCountry('VA', '');
  assert.equal(vaticanStates.hasStates, false);
  assert.equal(vaticanStates.states.length, 0);
});

test('searchWorldwideSettlements scopes strictly by countryCode and finds small towns/villages', async () => {
  // Paris inside US must NEVER return Paris, France
  const usParis = await searchWorldwideSettlements({
    countryCode: 'US',
    countryName: 'United States',
    query: 'Paris',
    limit: 10,
  });
  assert.ok(usParis.cities.length > 0);
  assert.ok(usParis.cities.every((c) => c.countryCode === 'US'));

  // Smaller towns/villages inside Maharashtra, India
  const mhTown = await searchWorldwideSettlements({
    countryCode: 'IN',
    countryName: 'India',
    stateCode: 'MH',
    stateName: 'Maharashtra',
    query: 'Hinganghat',
    limit: 10,
  });
  assert.ok(mhTown.cities.some((c) => c.name.toLowerCase() === 'hinganghat' && c.countryCode === 'IN'));

  // Direct countrywide search without selecting a state still returns state metadata
  const directTown = await searchWorldwideSettlements({
    countryCode: 'IN',
    countryName: 'India',
    query: 'Sevagram',
    limit: 10,
  });
  assert.ok(directTown.cities.some((c) => c.name.toLowerCase().includes('sevagram') && c.countryCode === 'IN'));
});

test('disambiguates identically named cities across states with distinct subtitles', async () => {
  const springfields = await searchWorldwideSettlements({
    countryCode: 'US',
    countryName: 'United States',
    query: 'Springfield',
    limit: 15,
  });
  const statesSet = new Set(springfields.cities.map((c) => c.state).filter(Boolean));
  assert.ok(statesSet.size >= 2, `Expected multiple US states for Springfield, got ${Array.from(statesSet).join(', ')}`);
});
