import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTER_CONFIG, isDefaultValue, resolveFilterConfig, settingOverrides } from '../../src/core/config';

describe('resolveFilterConfig', () => {
  it('sans ligne, renvoie la configuration livrée', () => {
    expect(resolveFilterConfig([])).toEqual(DEFAULT_FILTER_CONFIG);
  });

  it('surcharge les critères présents et ignore les valeurs mal typées', () => {
    const config = resolveFilterConfig([
      { key: 'max_experience_years', value: 5 },
      { key: 'accepted_titles', value: ['data', ' bi ', ''] },
      { key: 'finance_keywords', value: 'pas une liste' },
      { key: 'inconnue', value: 42 },
    ]);
    expect(config.maxExperienceYears).toBe(5);
    expect(config.acceptedTitles).toEqual(['data', 'bi']);
    expect(config.financeKeywords).toEqual(DEFAULT_FILTER_CONFIG.financeKeywords);
  });

  it('ne modifie pas l’objet des défauts', () => {
    resolveFilterConfig([{ key: 'accepted_titles', value: ['x'] }]);
    expect(DEFAULT_FILTER_CONFIG.acceptedTitles).toContain('data');
  });
});

describe('settingOverrides', () => {
  it('ne renvoie que les écarts par rapport aux défauts', () => {
    const config = { ...DEFAULT_FILTER_CONFIG, maxExperienceYears: 4 };
    expect(settingOverrides(config)).toEqual([{ key: 'max_experience_years', value: 4 }]);
    expect(settingOverrides(DEFAULT_FILTER_CONFIG)).toEqual([]);
    expect(isDefaultValue('maxExperienceYears', config)).toBe(false);
    expect(isDefaultValue('acceptedTitles', config)).toBe(true);
  });
});
