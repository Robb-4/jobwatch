import { describe, expect, it } from 'vitest';
import { detectExperienceRequirements, detectMaxExperienceRequirement } from '../../src/core/experience';
import { normalizeText } from '../../src/core/normalize';

const detect = (text: string) => detectMaxExperienceRequirement(normalizeText(text));

describe('détection des exigences d’expérience', () => {
  it('reconnaît les chiffres et les nombres en toutes lettres', () => {
    expect(detect('Vous justifiez de 5 ans d’expérience')?.years).toBe(5);
    expect(detect('Expérience de trois ans souhaitée')?.years).toBe(3);
    expect(detect('une expérience de deux années')?.years).toBe(2);
  });

  it('reconnaît « 3+ ans » et l’anglais « years »', () => {
    expect(detect('3+ ans d’expérience')?.years).toBe(3);
    expect(detect('5+ years of experience in analytics')?.years).toBe(5);
  });

  it('retient la borne basse d’une fourchette', () => {
    expect(detect('une expérience de 3 à 6 ans')?.years).toBe(3);
    expect(detect('expérience 3-5 ans')?.years).toBe(3);
    expect(detect('entre 2 et 4 ans d’expérience')?.years).toBe(2);
    expect(detect('expérience de 3 ans à 5 ans')?.years).toBe(3);
  });

  it('ignore « N ans » sans mot de contexte à proximité', () => {
    expect(detect('Société créée il y a 12 ans, leader de son marché')).toBeNull();
  });

  it('ignore une durée implausible même avec un mot de contexte (ancienneté d’une société)', () => {
    expect(detect('Fort de 30 ans d’expérience, notre cabinet recrute un analyste.')).toBeNull();
  });

  it('ignore un plafond (« moins de 5 ans »)', () => {
    expect(detect('moins de 5 ans d’expérience')).toBeNull();
  });

  it('retient la plus élevée quand plusieurs exigences sont mentionnées', () => {
    const text = 'Expérience de 2 ans en SQL requise. Minimum 5 ans sur un poste similaire exigé.';
    expect(detect(text)?.years).toBe(5);
    expect(detectExperienceRequirements(normalizeText(text))).toHaveLength(2);
  });

  it('fournit l’extrait déclencheur', () => {
    expect(detect('5 ans minimum')?.snippet).toBe('5 ans');
  });
});
