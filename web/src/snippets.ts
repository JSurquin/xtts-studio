export type Snippet = {
  title: string;
  text: string;
};

export const SNIPPETS: Snippet[] = [
  {
    title: "Le terminal",
    text: "On ouvre un terminal, et on se retrouve face à un shell. Le shell attend une ligne, il la comprend, il lance le programme demandé, puis il rend la main. Imaginons que je veuille voir ce qu'il y a dans le dossier où je me trouve. Je tape la commande de liste. Le shell cherche ce programme, le démarre, et le texte s'affiche juste en dessous. Si je me trompe d'un caractère, la réponse n'est pas un silence. C'est un message. Ce message dit souvent le nom qui n'a pas été trouvé, ou le dossier qui manque. En formation, je m'arrête toujours sur ce message. On le lit ensemble, mot à mot, avant de retaper la commande. Ensuite je demande à chacun : dans quel dossier êtes-vous, quelle commande venez-vous de lancer, et qu'est-ce que le système a répondu. Avec ces trois réponses, on sait déjà où chercher. Le terminal devient alors un outil de travail, et plus seulement une fenêtre noire qui fait un peu peur.",
  },
  {
    title: "Les fichiers",
    text: "Le disque est organisé comme un arbre. À la racine, des dossiers. Dans chaque dossier, des fichiers, ou encore d'autres dossiers. Quand on donne un chemin qui commence par la racine, on parle d'un chemin absolu. Il désigne le même endroit, quel que soit le dossier où l'on se trouve. Un chemin relatif, lui, part d'ici. Il dépend donc de l'endroit où la commande est lancée. C'est la cause la plus fréquente d'un fichier introuvable. Le fichier existe, mais on le cherche depuis le mauvais dossier. Après le chemin, il y a les droits. Lire, écrire, exécuter. Un script peut être là, visible, et refuser de démarrer, simplement parce que le droit d'exécution n'est pas posé. En salle, je fais afficher les droits avant toute modification. On regarde qui peut lire, qui peut modifier, qui peut lancer. On comprend la ligne, et seulement ensuite on change un droit. De cette façon, on ne verrouille pas un dossier partagé en croyant juste rendre un fichier exécutable.",
  },
  {
    title: "Les processus",
    text: "Dès qu'un programme démarre, le système lui crée un processus. Ce processus a un numéro, un propriétaire, et un état. Il tourne, il attend quelque chose, ou il est déjà terminé. Quand une fenêtre ne répond plus, le bon réflexe est de retrouver ce processus, et de laisser la machine allumée. On affiche la liste, on repère la ligne, on regarde depuis combien de temps elle vit. Ensuite on demande un arrêt propre. Le programme peut alors fermer ses fichiers et quitter. Si rien ne bouge, on force l'arrêt, et là la coupure est immédiate. Je montre toujours les deux, l'un après l'autre, pour que la différence se voie. En formation, on lance une commande volontairement longue, on la retrouve dans la liste pendant qu'elle travaille, puis on l'arrête et on vérifie que la ligne a disparu. À partir de ce moment-là, un programme bloqué se nomme. C'est une ligne qu'on sait retrouver, et qu'on sait arrêter.",
  },
  {
    title: "Git",
    text: "Git sert à garder la mémoire d'un projet. Chaque commit est une photo du travail à un moment précis, accompagnée d'une phrase qui dit pourquoi ce changement existe. Avant d'enregistrer cette photo, on regarde ce qui a réellement bougé. Une correction de faute et un grand renommage n'ont pas la même raison d'être. Si on les mélange dans le même commit, le lendemain on ne peut plus annuler l'un sans perdre l'autre. La branche permet d'essayer une idée à côté de la version qui fonctionne. On avance, on casse, on recommence, et la version de la salle reste intacte. Quand l'essai est concluant, on ramène ce travail sur la branche principale. Pendant le cours, je fais faire un petit commit à chaque étape réussie. L'historique devient le sommaire de la journée. Quelqu'un qui se perd peut revenir à l'étape d'avant, relire le message, et repartir avec le groupe.",
  },
  {
    title: "Client et serveur",
    text: "Une page web naît d'une conversation entre deux programmes. Le navigateur est le client. Il envoie une requête : je voudrais telle page, à telle adresse. Le serveur reçoit cette demande, prépare une réponse, et la renvoie. Pour que les deux se trouvent, il faut une adresse, un port, et un accord sur la façon de parler. Si la page reste blanche, on vérifie les choses dans l'ordre. Est-ce que le serveur tourne vraiment. Est-ce que l'adresse tapée est celle où il écoute. Est-ce que le port est le bon. Ensuite on lit le code de la réponse. Un code deux cents veut dire que la requête a abouti. Un code quatre cent quatre veut dire que rien ne porte ce nom à cet endroit. Un code cinq cents veut dire que le serveur a échoué en préparant sa réponse. En formation, je fais lire ce code à voix haute. Il dit déjà dans quel camp il faut chercher, chez celui qui demande, ou chez celui qui répond.",
  },
  {
    title: "Chercher un bug",
    text: "Un bug, c'est un écart entre ce qu'on attendait et ce qui est arrivé. La première étape est de le reproduire. Tant qu'on ne sait pas le refaire, on ne pourra pas être sûr qu'il a disparu. Une fois qu'il revient à coup sûr, on réduit l'exemple. On retire tout ce qui ne change rien, jusqu'à garder la plus petite situation qui casse encore. Là seulement, on lit le message, on va à la ligne indiquée, et on modifie une seule chose. Si on en change deux, et que le problème s'en va, on ignore laquelle l'a réparé, et on risque de le réintroduire demain. Je demande à chaque stagiaire d'écrire deux phrases sur une feuille. Ce que j'observe. Ce que j'attendais. Ces deux phrases prennent une minute, et elles évitent souvent une heure de modifications au jugé. Le débogage devient alors une suite de petites expériences, que l'on peut raconter du début à la fin.",
  },
  {
    title: "Essai court",
    text: "Bonjour, je teste ma voix clonée. Est-ce que le rythme sonne naturel ?",
  },
];
