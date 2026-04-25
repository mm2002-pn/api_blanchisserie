# Blanchisserie SN — API

API REST pour le système de gestion **Blanchisserie SN**. Sert :

- Mobile **Hôtel** (commandes, suivi, factures)
- Mobile **Driver** (tournées, scan QR, livraison)
- Mobile **Supervisor** (production, qualité, équipe)
- Web **Admin** (workflow complet, paramétrage, rapports)

---

## 🏗 Stack

| Couche | Choix |
|---|---|
| Runtime | **Node 20+** (ESM) |
| Framework | **Express 4** + TypeScript strict |
| ORM | **Prisma 5** + PostgreSQL |
| Validation | **Zod** (DTOs runtime + types) |
| Auth | JWT **access (15m) + refresh (30j)** rotatifs avec révocation, Argon2id pour les passwords |
| AI | **Groq SDK** (`llama-3.3-70b-versatile`) pour bin-packing batches |
| Sécurité | Helmet, CORS strict, Rate limiting (global + login), audit log immuable |
| Logging | Pino structuré JSON + pretty en dev, request-id propagé |

## 🛡 Approche transactionnelle

**Toutes les écritures qui touchent à plus d'une ligne** sont enveloppées dans `prisma.$transaction`. Les opérations critiques utilisent `isolationLevel: Serializable` :

- Login → update user + insert refresh token + audit log
- Création commande → check client + insert order + audit log
- Réception → check version (optimistic lock) + update + audit
- Triage → check workflow state + insert triage + items + génération `N` ItemTags + audit
- Bin-packing persist → création N batches + N×M contributors + update tous les tags

**Optimistic locking** : champ `version` sur `Order` et `Invoice`. Toute mutation passe `expectedVersion` et compare avant écriture (409 si conflit).

## 🚀 Démarrer en local

```bash
# 1. Dépendances
npm install

# 2. Variables d'environnement
cp .env.example .env
# éditer JWT_*, DATABASE_URL, GROQ_API_KEY

# 3. Postgres (si tu utilises Docker)
docker run -d --name pg-blanchisserie \
  -e POSTGRES_USER=blanchisserie \
  -e POSTGRES_PASSWORD=blanchisserie \
  -e POSTGRES_DB=blanchisserie \
  -p 5432:5432 postgres:16-alpine

# 4. Migrations + seed
npm run prisma:migrate
npm run prisma:seed

# 5. Lancer
npm run dev
```

L'API écoute sur **http://localhost:4000** par défaut. Endpoint racine : `GET /api/v1/`.

### Compte admin par défaut (seed)

```
email    : admin@blanchisserie.sn
password : Password!1
```

## 📁 Architecture

```
src/
├─ config/                env, prisma, logger, groq (singletons)
├─ middleware/            auth, error, rate-limit, validate, request-id
├─ modules/               1 dossier par domaine métier (DDD-lite)
│  ├─ auth/               login + refresh + change-password
│  ├─ clients/            hôtels/restaurants
│  ├─ orders/             commandes (workflow 10 états)
│  ├─ triage/             triage + génération ItemTags étiquettes
│  ├─ batches/            cycles machine multi-clients (Kanban)
│  └─ ai/                 bin-packing Groq
├─ routes/                router central (mount des modules)
├─ utils/                 errors, jwt, password, async-handler
├─ app.ts                 setup Express
└─ server.ts              entry point
prisma/
├─ schema.prisma          17 modèles end-to-end
└─ seed.ts                admin + 22 programmes + types linge + machines
```

## 🧠 Bin-packing IA

Le service `modules/ai/bin-packing.service.ts` :

1. **Heuristique Best-Fit Decreasing** locale (toujours exécutée, instantanée) :
   - Groupe les ItemTags par programme compatible
   - Trie par poids décroissant + priorité
   - Remplit chaque machine au maximum sans dépasser sa capacité
2. **Validation Groq** (si `GROQ_API_KEY` présent) :
   - Envoie la proposition + contexte au modèle Llama 3.3 70B
   - Le modèle valide ou propose des ajustements
   - Tombe en fallback heuristique en cas d'erreur/timeout

**Économies estimées** retournées au front (eau, kWh) pour justifier la suggestion.

## 🔐 Endpoints (v1)

| Méthode | Route | Rôles |
|---|---|---|
| `POST` | `/auth/login` | public (rate-limited) |
| `POST` | `/auth/refresh` | public |
| `POST` | `/auth/logout` | public (token requis) |
| `GET` | `/auth/me` | tous (JWT) |
| `POST` | `/auth/change-password` | tous (JWT) |
| `GET` | `/clients` | admin / manager / supervisor / operator |
| `POST` | `/clients` | admin / manager |
| `GET` | `/clients/:id` | tous (hôtel limité à son propre id) |
| `PATCH` | `/clients/:id` | admin / manager |
| `GET` | `/orders` | tous (hôtel : ses commandes uniquement) |
| `POST` | `/orders` | hôtel / admin / manager / operator |
| `GET` | `/orders/:id` | tous (scope hôtel) |
| `POST` | `/orders/:id/collect` | driver / admin / manager |
| `POST` | `/orders/:id/receive` | operator / supervisor / admin |
| `POST` | `/orders/:id/cancel` | admin / manager |
| `POST` | `/triage/orders/:orderId` | operator / supervisor / admin |
| `POST` | `/triage/orders/:orderId/labels/print` | operator / supervisor |
| `GET` | `/triage/orders/:orderId/tags` | tous |
| `GET` | `/batches?stage=lavage` | tous |
| `POST` | `/batches/suggest` | supervisor / manager / admin |
| `POST` | `/batches/persist` | supervisor / manager / admin |
| `POST` | `/batches/:id/start` | supervisor / operator |

Endpoints à compléter dans les phases suivantes : `/users`, `/machines`, `/wash-programs`, `/linen-types`, `/tariffs`, `/invoices`, `/notifications`, `/reports`, `/audit-logs`.

## 🧪 Health

```bash
curl http://localhost:4000/health
# {"status":"ok","uptime":123,"env":"development"}
```

## 🪪 Format d'erreur unifié

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": { "fieldErrors": { "email": ["Invalid email"] } }
  }
}
```

Codes courants : `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `DUPLICATE`, `VALIDATION_ERROR`, `TOO_MANY_REQUESTS`, `CONCURRENT_UPDATE`, `INTERNAL_ERROR`.

Header `X-Request-Id` propagé pour le debug.

## 📜 Scripts

| Script | Usage |
|---|---|
| `npm run dev` | API en watch mode (tsx) |
| `npm run build` | Compile TS → dist/ |
| `npm start` | Lance dist/server.js |
| `npm run typecheck` | TS check sans émission |
| `npm run lint` | ESLint |
| `npm run prisma:migrate` | Crée/applique les migrations en dev |
| `npm run prisma:seed` | Charge le seed |
| `npm run prisma:studio` | UI Prisma Studio (port 5555) |
| `npm run prisma:reset` | Reset complet de la base |

---

🇸🇳 Blanchisserie SN · Dakar
