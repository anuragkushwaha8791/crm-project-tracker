# Mooving CRM - setup checklist (do these in order)

1. Upload ALL files in this folder to your website / GitHub together (the pages depend on each other).
2. Firebase Console > Firestore Database > Rules: paste the whole `firestore.rules` file and press **Publish**.
   (Skipping this causes "permission-denied" - for example when assigning a task or saving the AI key.)
3. Firebase Console > Authentication > Settings > User actions: turn **off** "Enable create (sign-up)" so strangers cannot make accounts.
4. Sign in as an Admin > Profile Settings > **Permission check** > Run check. Every line must show a green tick.
5. Profile Settings > **AI Operations**: paste a NEW Gemini key and press Save key. (Never put keys in the code.)
6. Optional - Firestore TTL: collections `notifications` and `activityLogs`, field `expireAt` (auto-delete after 30 days).
7. Admin Panel > **Access** button on each person: tick what that person may do.
8. AI Code Studio (main account only): create a GitHub fine-grained token for ONE repository with "Contents: Read and write",
   paste it on the AI Code Studio page together with `owner/repo`. Changes go to a separate branch first.
9. Optional: put your own licensed sticker at `welcome-sticker.png` next to index.html - it replaces the built-in drawing.
