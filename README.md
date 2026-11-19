# Studio voix

Interface locale pour cloner ta voix et tester quelques phrases. Deux moteurs, au choix :

- **XTTS v2**, chargé dans ce projet
- **Fish Speech**, s'il tourne à côté sur son propre serveur

L'audio reste sur la machine. Le bouton en haut de l'interface bascule d'un moteur à l'autre. Chaque pastille indique si ce moteur est prêt.

## Lancer

```bash
./start.sh
```

Ouvre http://127.0.0.1:5173

Au premier lancement, XTTS (environ 2 Go) se télécharge. Sa pastille passe à « Prêt ». Sur ce Mac, le calcul XTTS est sur le CPU : une phrase courte sort en quelques secondes.

Fish Speech n'est pas embarqué dans le même environnement Python : ses dépendances et ses poids entrent en conflit avec Coqui. Le studio lui envoie la synthèse en HTTP.

## Utiliser

1. Enregistre deux à quatre phrases d'une dizaine de secondes, ou importe plusieurs wav / mp3 / m4a. Huit extraits maximum. Le modèle moyenne les prises.
2. Garde la voix. Tu peux ajouter d'autres extraits ensuite.
3. Choisis **XTTS** ou **Fish Speech**.
4. Choisis la voix, colle une phrase, génère.
5. Chaque extrait est transcrit sur la machine. **Choisir ce texte** le met dans la zone. **Comparer** joue l'enregistrement à gauche et le clone à droite, sur les mêmes mots.

XTTS peut aussi parler avec une voix livrée dans le modèle. Fish Speech ne clone que tes extraits, et il a besoin de leur transcription.

Les voix enregistrées sont dans `data/voices/`. Ce dossier n'est pas versionné.

## Fish Speech

Installe [fish-speech](https://github.com/fishaudio/fish-speech) dans un environnement à part, puis démarre son API, par exemple :

```bash
python tools/api_server.py \
  --llama-checkpoint-path checkpoints/s2-pro \
  --decoder-checkpoint-path checkpoints/s2-pro/codec.pth \
  --listen 127.0.0.1:8080
```

Le studio interroge `http://127.0.0.1:8080`. Autre adresse : `FISH_API_URL`. Clé si le serveur en exige une : `FISH_API_KEY`.

La requête reprend le format msgpack de `tools/api_client.py` : le texte à dire, plus l'audio et la transcription de l'extrait choisi. **Mélanger toutes les prises** envoie chaque extrait comme référence.

Le modèle S2-Pro vise un GPU. Ce Mac fait tourner XTTS sur le CPU ; Fish Speech reste utilisable dès que son serveur répond.

## Installation déjà faite

- Python 3.12 dans `.venv`
- PyTorch + `coqui-tts`
- Interface Vite dans `web/`
- `ffmpeg` pour convertir le micro en wav 24 kHz mono

Pour réinstaller les paquets Python :

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install torch torchaudio
.venv/bin/python -m pip install -r server/requirements.txt
cd web && pnpm install
```

`XTTS_DEVICE=cpu` est le défaut. MPS existe sur cette machine, et ce modèle plante encore souvent dessus.

## Licences

XTTS v2 est sous licence CPML, usage non commercial. `COQUI_TOS_AGREED=1` accepte cette licence au téléchargement. Le moteur est le paquet [`coqui-tts`](https://github.com/idiap/coqui-ai-TTS). Le modèle est [XTTS v2](https://huggingface.co/coqui/XTTS-v2).

Fish Speech et ses poids ont leur propre licence, en général non commerciale. Réservé à ta propre voix.
