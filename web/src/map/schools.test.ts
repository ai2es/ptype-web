import { describe, expect, it } from 'vitest';
import { describePlaces, formatPlaces, gradeRange, parsePlaces, tidyName } from './schools';

describe('places in the page address', () => {
  it('reads the toggles that are named and leaves the rest off', () => {
    expect(parsePlaces('districts,private')).toEqual({ districts: true, publicSchools: false, privateSchools: true });
    expect(parsePlaces(null)).toEqual({ districts: false, publicSchools: false, privateSchools: false });
    expect(parsePlaces('nonsense')).toEqual({ districts: false, publicSchools: false, privateSchools: false });
  });

  it('writes back what it reads', () => {
    const places = { districts: true, publicSchools: true, privateSchools: false };
    expect(formatPlaces(places)).toBe('districts,public');
    expect(parsePlaces(formatPlaces(places))).toEqual(places);
  });
});

describe('names and grades', () => {
  it('puts names written in capitals into title case and leaves the others alone', () => {
    expect(tidyName('WASHINGTON ACADEMY')).toBe('Washington Academy');
    expect(tidyName('ST. MARY-OF-THE-LAKE (K-8)')).toBe('St. Mary-Of-The-Lake (K-8)');
    expect(tidyName('McKinley High School')).toBe('McKinley High School');
  });

  it('formats a grade range and gives nothing when a grade is missing', () => {
    expect(gradeRange('KG', '12')).toBe('K–12');
    expect(gradeRange('PK', '08')).toBe('PK–8');
    expect(gradeRange('', '12')).toBe('');
    expect(gradeRange(undefined, undefined)).toBe('');
  });
});

describe('describePlaces', () => {
  const district = { layer: 'districts-hit', properties: { NAME: 'Boulder Valley School District RE-2', LOGRADE: 'PK', HIGRADE: '12' } };
  const school = { layer: 'schools-public', properties: { NAME: 'Fairview High School', CITY: 'Boulder', STATE: 'CO' }, lngLat: [-105.25, 39.97] as [number, number] };
  const privateSchool = { layer: 'schools-private', properties: { NAME: 'SACRED HEART OF JESUS SCHOOL', CITY: 'BOULDER', STATE: 'CO' }, lngLat: [-105.28, 40.02] as [number, number] };

  it('is null when nothing named is under the pointer', () => {
    expect(describePlaces([])).toBeNull();
    expect(describePlaces([{ layer: 'schools-public', properties: {} }])).toBeNull();
  });

  it('reports the school with its place and kind, and the district with its grades', () => {
    expect(describePlaces([school, district])).toEqual({
      school: 'Fairview High School · Boulder, CO · public',
      schoolLngLat: [-105.25, 39.97],
      district: 'Boulder Valley School District RE-2 (PK–12)',
    });
  });

  it('marks a private school and tidies its capitals', () => {
    expect(describePlaces([privateSchool])?.school).toBe('Sacred Heart Of Jesus School · Boulder, CO · private');
  });

  it('keeps the first school and the first district when several overlap', () => {
    const other = { layer: 'districts-hit', properties: { NAME: 'Another District' } };
    const hover = describePlaces([privateSchool, school, district, other]);
    expect(hover?.school).toContain('Sacred Heart');
    expect(hover?.district).toBe('Boulder Valley School District RE-2 (PK–12)');
  });
});
