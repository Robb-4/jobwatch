import { supabase } from '../supabase';
import { errorMessage, h } from '../ui';

/**
 * Connexion Supabase Auth (email + mot de passe). L'inscription publique est
 * désactivée dans les réglages Supabase : le compte unique se crée à la main
 * dans le tableau de bord.
 */
export function renderLogin(): HTMLElement {
  const email = h('input', { type: 'email', name: 'email', placeholder: 'Adresse e-mail', required: true, autocomplete: 'username' });
  const password = h('input', { type: 'password', name: 'password', placeholder: 'Mot de passe', required: true, autocomplete: 'current-password' });
  const submit = h('button', { type: 'submit', class: 'primary' }, 'Se connecter');
  const feedback = h('p', { class: 'muted small' }, '');

  const form = h(
    'form',
    {
      onSubmit: (event: Event) => {
        event.preventDefault();
        submit.disabled = true;
        feedback.textContent = 'Connexion…';
        void supabase.auth
          .signInWithPassword({ email: email.value.trim(), password: password.value })
          .then(({ error }) => {
            if (error) {
              feedback.textContent = `Connexion refusée : ${error.message}`;
              feedback.className = 'small';
              feedback.style.color = 'var(--error)';
            }
          })
          .catch((error) => {
            feedback.textContent = `Erreur : ${errorMessage(error)}`;
          })
          .finally(() => {
            submit.disabled = false;
          });
      },
    },
    email,
    password,
    submit,
    feedback,
  );

  return h(
    'div',
    { class: 'login card' },
    h('h1', {}, 'JobWatch'),
    h('p', { class: 'muted' }, 'Veille privée : connexion requise.'),
    form,
  );
}
