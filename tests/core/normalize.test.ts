import { describe, expect, it } from 'vitest';
import { containsPhrase, findPhrase, normalizeText, stripHtml } from '../../src/core/normalize';

describe('normalizeText', () => {
  it('met en minuscules, retire les accents et la ponctuation', () => {
    expect(normalizeText('Analyste de Données (H/F) — CDI !')).toBe('analyste de donnees h f cdi');
  });

  it('supprime les balises HTML et décode les entités', () => {
    expect(normalizeText('<p>Data&nbsp;Analyst</p><br/>&eacute;quipe &amp; co')).toBe('data analyst equipe co');
    expect(stripHtml('a&#39;b &#x27;c')).toBe("a'b 'c");
  });

  it('conserve le « + » collé à un chiffre, pas ailleurs', () => {
    expect(normalizeText('3+ ans')).toBe('3+ ans');
    expect(normalizeText('Bac+5, C++')).toBe('bac 5 c');
  });

  it('préserve une fourchette écrite avec un tiret ou une barre', () => {
    expect(normalizeText('3-5 ans')).toBe('3 a 5 ans');
    expect(normalizeText('2/4 ans')).toBe('2 a 4 ans');
  });

  it('renvoie une chaîne vide pour null ou undefined', () => {
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
  });
});

describe('containsPhrase (mots entiers)', () => {
  it('« data » ne matche pas « database »', () => {
    expect(containsPhrase(normalizeText('Database administrator'), 'data')).toBe(false);
    expect(containsPhrase(normalizeText('Data engineer'), 'data')).toBe(true);
  });

  it('« bank » ne matche pas « bankable »', () => {
    expect(containsPhrase(normalizeText('projet bankable'), 'bank')).toBe(false);
  });

  it('« bancaire » ne matche pas « bancaires » : les deux formes doivent être listées', () => {
    expect(containsPhrase(normalizeText('services bancaires'), 'bancaire')).toBe(false);
    expect(containsPhrase(normalizeText('services bancaires'), 'bancaires')).toBe(true);
  });

  it('normalise l’expression cherchée elle-même', () => {
    expect(containsPhrase(normalizeText('Crédit Agricole SA'), 'Crédit Agricole')).toBe(true);
    expect(findPhrase(normalizeText('Chez Société Générale'), ['BNP', 'Société Générale'])).toBe('Société Générale');
  });
});
