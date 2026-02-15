# Payroll Dashboard (React + GitHub Pages + Google Login)

## 1. GitHub setup
1. Create a GitHub account: https://github.com/signup
2. Create a new repository (recommended name: `payroll-dashboard`).
3. In this folder, run:
   - `git init`
   - `git add .`
   - `git commit -m "Initial payroll dashboard"`
   - `git branch -M main`
   - `git remote add origin https://github.com/<your-username>/<your-repo>.git`
   - `git push -u origin main`

## 2. Configure Firebase for Google login
1. Go to Firebase Console: https://console.firebase.google.com/
2. Create a project.
3. In **Authentication > Sign-in method**, enable **Google**.
4. Add a Web app in Firebase and copy config values.
5. Local development: copy `.env.example` to `.env.local` and paste your Firebase values.

## 3. Configure Firebase Authorized Domains
Add these domains in Firebase Authentication settings:
- `localhost`
- `<your-username>.github.io`

If your project page URL includes a repo path, domain is still only `<your-username>.github.io`.

## 4. Add GitHub repository secrets
In GitHub repo: **Settings > Secrets and variables > Actions > New repository secret**
Add:
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

## 5. Enable GitHub Pages deployment
1. Workflow file already exists at `.github/workflows/deploy.yml`.
2. In GitHub repo: **Settings > Pages**
   - Build and deployment: **GitHub Actions**
3. Push to `main`.
4. After workflow completes, open:
   - `https://<your-username>.github.io/<your-repo>/`

## 6. Local run
1. `npm install`
2. `npm run dev`

## Important production note
Current payroll data is stored in browser `localStorage` and proof files in IndexedDB, so data is per-user/per-browser and not shared. For true multi-user shared payroll operations, add a backend data layer (for example Firebase Firestore + Cloud Storage with role-based access rules).
