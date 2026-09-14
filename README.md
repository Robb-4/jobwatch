# JobWatch — veille d'offres d'emploi data, sans serveur

Veille personnelle qui interroge automatiquement des API d'offres d'emploi
(Adzuna, France Travail), filtre selon des critères configurables, déduplique,
et envoie un rapport par mail deux fois par jour. Une interface web privée
permet de consulter les offres, d'ajuster les critères et de tester une annonce.

Aucun serveur à administrer : **GitHub Actions** (tâches planifiées),
**Supabase** (PostgreSQL + authentification) et **GitHub Pages** (interface),
tous en offre gratuite. Tout le code est en TypeScript, y compris le front : la
logique de filtrage (`src/core/`) est partagée à l'identique entre le script
d'ingestion et le testeur de l'interface.

```
src/core/          # partagé Actions <-> web : types, normalisation, filtres, dédup
src/sources/       # une implémentation par API (adzuna, francetravail)
src/tasks/         # points d'entrée appelés par Actions : fetch, report, purge
web/               # interface statique (Vite, TypeScript sans framework)
supabase/          # migration SQL + politiques RLS
.github/workflows/ # fetch, report, purge, pages, keepalive
tests/             # Vitest : filtrage, dédup, sources (HTTP simulé), tâches
```

---

## 1. Mise en place pas à pas

### 1.1 Créer le projet Supabase et appliquer la migration

1. Créer un projet sur <https://supabase.com> (offre gratuite).
2. Ouvrir **SQL Editor**, coller le contenu de
   [`supabase/migrations/20260914000000_init.sql`](supabase/migrations/20260914000000_init.sql)
   et exécuter. Cela crée les tables `job_offers`, `source_runs`, `settings`,
   les index, les vues du tableau de bord et **active Row Level Security** avec
   des politiques réservées au rôle `authenticated`.

   > Alternative en ligne de commande : `supabase link` puis `supabase db push`.

3. Vérifier dans **Table Editor** que les trois tables affichent le cadenas
   « RLS enabled ». Sans session ouverte, la clé `anon` ne renvoie rien : c'est
   ce qui rend possible un front public sur GitHub Pages.

### 1.2 Désactiver l'inscription publique et créer le compte unique

1. **Authentication → Providers → Email** : laisser Email activé.
2. **Authentication → Sign In / Providers** (ou *Settings*) :
   **« Allow new users to sign up » → OFF**. Sans cela, n'importe qui crée un
   compte et lit la veille.
3. **Authentication → Users → Add user → Create new user** : saisir votre
   e-mail et un mot de passe, cocher *Auto Confirm User*. C'est le seul compte
   qui pourra ouvrir l'interface.

### 1.3 Récupérer les clés Supabase

**Project Settings → API** :

| Clé | Usage | Où la mettre |
| --- | ----- | ------------ |
| Project URL | partout | secret GitHub `SUPABASE_URL` |
| `anon` `public` | interface web (publique par conception) | secret GitHub `SUPABASE_ANON_KEY` |
| `service_role` `secret` | workflows Actions (contourne RLS) | secret GitHub `SUPABASE_SERVICE_ROLE_KEY` |

⚠️ La clé `service_role` ne doit **jamais** apparaître dans `web/` ni dans une
variable `VITE_*` : tout ce qui est préfixé `VITE_` finit dans les fichiers
publiés.

### 1.4 Obtenir les identifiants des sources

**Adzuna** — <https://developer.adzuna.com/> : créer une application, récupérer
`app_id` (8 caractères) et `app_key` (32 caractères). Gratuit, quota généreux.

**France Travail** — <https://francetravail.io/> :

1. Créer un compte, puis une application.
2. Souscrire à l'API **Offres d'emploi v2** ; noter le *client ID* et le
   *client secret*.
3. ⚠️ La source France Travail n'a **jamais été validée contre l'API réelle**
   faute d'identifiants (écrite d'après la documentation). Au premier appel réel,
   vérifier en particulier :
   - que l'authentification passe depuis GitHub Actions (plages d'IP sortantes
     acceptées par le profil déclaré) ;
   - le comportement de `motsCles` : s'il cherche dans tout le texte de
     l'annonce, le nombre d'offres écartées pour « intitulé hors cible » sera
     élevé — c'est attendu, le filtrage local compense — mais il faudra peut-être
     ajuster `DEFAULT_FRANCETRAVAIL_SEARCHES` dans `src/sources/francetravail.ts`.

Une source sans identifiants est simplement ignorée par la tâche `fetch`.

### 1.5 Configurer le SMTP

Tout fournisseur SMTP classique convient (Gmail avec mot de passe d'application,
Brevo, Mailgun, OVH…). Port 587 (STARTTLS) par défaut, 465 pour TLS implicite.

### 1.6 Renseigner les secrets GitHub

Créer un dépôt GitHub (privé ou public : aucune donnée n'y transite), pousser
le code, puis **Settings → Environments → New environment**, nommé exactement
`jobwatch`, et y ajouter chaque secret (**Add environment secret**). Les
workflows déclarent `environment: jobwatch` et ne lisent que ces secrets-là ;
les secrets *Codespaces* et *Dependabot* ne servent à rien ici.

| Secret | Contenu |
| ------ | ------- |
| `SUPABASE_URL` | URL du projet |
| `SUPABASE_SERVICE_ROLE_KEY` | clé `service_role` |
| `SUPABASE_ANON_KEY` | clé `anon` (build de l'interface) |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | identifiants Adzuna |
| `FRANCETRAVAIL_CLIENT_ID`, `FRANCETRAVAIL_CLIENT_SECRET` | identifiants France Travail (optionnels) |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD` | SMTP |
| `MAIL_FROM`, `MAIL_TO` | expéditeur et destinataire du rapport |

Variables de dépôt optionnelles (**Variables**, pas *Secrets*) :

| Variable | Défaut | Rôle |
| -------- | ------ | ---- |
| `REPORT_HOURS` | `7 19` | heures Paris des rapports (séparées par des espaces) |
| `PURGE_DAYS` | `60` | ancienneté d'import au-delà de laquelle une offre est supprimée |
| `KEEPALIVE_MAX_AGE_DAYS` | `45` | inactivité avant un commit vide de maintien (voir §4) |

### 1.7 Activer GitHub Pages

**Settings → Pages → Build and deployment → Source : GitHub Actions.** Le
workflow `pages.yml` construit `web/` et le déploie à chaque push sur `main`
touchant `web/` ou `src/core/`. Lancer une première fois à la main via
**Actions → pages → Run workflow**. Le site est servi sous
`https://<utilisateur>.github.io/<nom-du-depot>/` ; le chemin de base est
injecté automatiquement (`VITE_BASE_PATH`).

### 1.8 Premier lancement

1. **Actions → fetch → Run workflow** : vérifier dans le journal les compteurs
   par source, puis dans Supabase que `job_offers` et `source_runs` se remplissent.
2. **Actions → report → Run workflow** : un mail doit arriver, même sans offre.
3. Ouvrir l'interface, se connecter avec le compte créé en 1.2.

---

## 2. Fonctionnement

### Tâches planifiées

| Workflow | Cron (UTC) | Rôle |
| -------- | ---------- | ---- |
| `fetch` | toutes les 2 h | récupère, déduplique, filtre, stocke ; une ligne `source_runs` par source |
| `report` | 05:15 / 06:15 et 17:15 / 18:15 | mail matin et soir, avec garde fuseau horaire |
| `purge` | dimanche 04:00 | supprime les offres importées il y a plus de 60 jours |
| `pages` | sur push | construit et déploie l'interface |
| `keepalive` | lundi 03:00 | commit vide si le dépôt est inactif depuis 45 jours (voir §4) |

Tous acceptent `workflow_dispatch` (bouton *Run workflow*). Chaque source est
isolée dans son propre try/catch : une API en panne n'empêche pas les autres, et
le workflow n'échoue que si **toutes** les sources ont échoué. Un échec de
workflow déclenche une notification GitHub : c'est le filet de sécurité.

### Rapport mail

- Objet : « JobWatch — X nouvelles offres (matin/soir) », ou « aucune nouvelle
  offre ». **Envoyé même sans offre** : un silence signifie une panne.
- Tableau des offres `new` (titre cliquable, entreprise, lieu, salaire, source,
  date), puis passage en `reported` **seulement après envoi réussi**.
- Encart en tête pour les sources **encore en panne au dernier essai**.
- Pied : total récupéré, écartées par les filtres, doublons ignorés depuis le
  dernier rapport — le baromètre de santé des filtres.

### Filtrage (`src/core/filter.ts`)

Quatre règles évaluées en séquence sur du texte normalisé (minuscules, sans
accents ni HTML ni ponctuation ; correspondance en **mots entiers**) ; la
première qui échoue donne le motif :

1. **Intitulé** contient une expression acceptée → sinon `title_not_matching`
2. **Finance / banque / assurance** : code NAF `64`/`65`/`66` (`finance_naf`) ou
   mot-clé dans l'entreprise, le secteur ou les 400 premiers caractères de la
   description (`finance_keyword`)
3. **Contrat** : CDI uniquement, avec alias (`permanent` → CDI)
4. **Expérience** : mots de séniorité dans le titre (`seniority_title`) puis la
   description (`seniority_description`, liste séparée), puis exigence explicite
   au-delà du seuil (`experience_too_high`) — chiffres et nombres en lettres,
   borne basse des fourchettes, mot de contexte obligatoire à ±80 caractères,
   exigence la plus élevée retenue.

Les offres rejetées sont **conservées** avec leur motif et l'élément
déclencheur : c'est le seul moyen de repérer un filtre trop agressif.

Les sept critères modifiables depuis l'interface (page *Critères*) sont stockés
dans `settings` comme écarts par rapport aux défauts de `src/core/config.ts`.
Le reste (mots de contexte, fenêtre, alias de contrat, paramètres d'API) reste
dans le code, commenté sur place.

### Déduplication

`dedup_hash = sha256(titre normalisé | entreprise normalisée)`. Une offre est
ignorée si elle existe déjà pour la même source (contrainte unique) ou si une
offre de même empreinte existe, quelle que soit la source. Ordre :
récupérer → dédupliquer → filtrer → stocker.

---

## 3. Sécurité

- Le site GitHub Pages est **public** : son code est lisible par tous, sans
  gravité. **Aucune donnée ne transite par les fichiers publiés** ; le front
  interroge Supabase directement.
- La clé `anon` est publique par conception. **RLS est activé sur toutes les
  tables** avec des politiques réservées à `authenticated` : sans session, rien
  ne sort.
- L'inscription publique est désactivée (§1.2) ; un seul compte existe.
- La clé `service_role` n'est utilisée que par les workflows, en secret GitHub.
- Pas de bouton « lancer une récupération » dans l'interface : sans serveur, il
  faudrait exposer un jeton GitHub. L'interface renvoie vers l'onglet Actions.

---

## 4. ⚠️ Désactivation automatique des workflows planifiés

GitHub **désactive les workflows planifiés après 60 jours sans activité sur le
dépôt** (aucun commit). Sur un dépôt personnel qu'on ne touche plus, la veille
s'arrête **en silence** : plus de mail, sans notification d'échec.

Compensation : le workflow `keepalive` pousse un commit vide quand le dernier
commit a plus de 45 jours, ce qui compte comme une activité. Il requiert
l'autorisation `contents: write` (déjà déclarée) et que **Settings → Actions →
General → Workflow permissions** soit sur *Read and write permissions*.

Si les workflows ont malgré tout été désactivés (bannière jaune dans l'onglet
Actions), les réactiver avec **Enable workflow** sur chacun. Autre indice : le
rapport « aucune nouvelle offre » n'arrive plus deux fois par jour.

Autres pièges Actions traités :

- **Cron en UTC, sans heure d'été** : `report` est déclenché aux deux heures
  UTC possibles et une étape de garde compare `TZ=Europe/Paris date +%H` aux
  heures voulues (`REPORT_HOURS`).
- **Retards de 5 à 15 min** sur les déclenchements planifiés : rien ne dépend
  d'une minute précise (rapports à h+15).

---

## 5. Développement local

```bash
npm install
cp .env.example .env      # renseigner les variables
npm test                  # Vitest : filtrage, dédup, sources (HTTP simulé), tâches
npm run typecheck         # tsc sur src/, tests/ et web/
npm run task:fetch        # récupération réelle vers Supabase (.env)
npm run task:report       # envoi du rapport
npm run web:dev           # interface sur http://localhost:5173
npm run web:build         # build de production dans web/dist
```

Les tests n'effectuent **aucun appel réseau** : les sources reçoivent un
`fetchImpl` simulé, les tâches un dépôt en mémoire. Deux non-régressions Adzuna
sont verrouillées : la requête contient `permanent=1` et pas `contract_type` ;
elle utilise `title_only` et pas `what_or`.

### Adzuna — faits vérifiés en production

- Pages numérotées à partir de 1 ; `results_per_page=50` maximum.
- CDI : `permanent=1`. `contract_type=permanent` → **HTTP 400 avec page HTML**.
- `title_only`, pas `what_or` (qui matche le mot « données » des paragraphes
  RGPD : 500 offres récupérées pour 5 retenues, contre 278 pour 197).
- `title_only` combine ses mots en **ET** : plusieurs recherches sont enchaînées
  (`data`, puis `analyste données`) et fusionnées par la déduplication.
- `salary_is_predicted === '1'` : estimation statistique, ignorée.
- Pas de code NAF : la règle NAF ne s'applique pas à cette source.
