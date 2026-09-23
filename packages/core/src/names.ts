// `population.ts` imports this file back; the cycle is safe because `seededRandom` is a hoisted
// function declaration and nothing here runs at module scope except two frozen arrays.
import { seededRandom } from "./population.js";

/**
 * Seeded names — tier 1 of person generation (SPEC §5.1). Always available, free and offline,
 * which is what keeps the whole test suite running with no `ANTHROPIC_API_KEY`. Tier 2 replaces a
 * person's name with one a model wrote, once, at authoring time; nothing here runs during a run.
 *
 * Stability does not come from this function. It comes from the fact that a `Person` row is
 * WRITTEN once and read forever after (SPEC §5.2). What this gives is a legible, comparable cast
 * for the same seed, and a cohort in which nobody shares a name with anybody else.
 *
 * The banks are deliberately multi-origin: a population is a cross-section of the people who will
 * actually use a product, and a name bank drawn from one language quietly says otherwise.
 */
const GIVEN_NAMES = [
  "Aaliyah", "Aditi", "Adrian", "Agnes", "Ahmed", "Aiko", "Ainhoa", "Alejandro", "Alessia", "Alice", "Amara", "Amir", "Ana", "Anders",
  "Andrea", "Aneta", "Anika", "Anton", "Arash", "Ariadne", "Arjun", "Asha", "Astrid", "Aurelio", "Ayesha", "Bao", "Beatriz", "Bilal",
  "Bjorn", "Brigid", "Bruno", "Caleb", "Camila", "Carlos", "Carmen", "Cato", "Cecile", "Chen", "Chiara", "Chidi", "Chloe", "Cian",
  "Claudia", "Cormac", "Dalia", "Damian", "Daniela", "Dario", "Dashiell", "Dawit", "Delphine", "Diego", "Dilara", "Dmitri", "Ebele",
  "Eero", "Efua", "Eitan", "Elena", "Eli", "Elif", "Elsa", "Emeka", "Emil", "Emilia", "Enzo", "Esme", "Esteban", "Eszter", "Ewa",
  "Fabien", "Fadi", "Farida", "Fatima", "Felix", "Fenna", "Fiona", "Florian", "Frida", "Gabriel", "Gaia", "Genevieve", "Gerda", "Gideon",
  "Giulia", "Grace", "Greta", "Gustavo", "Hanna", "Hassan", "Hector", "Helga", "Henrik", "Hiro", "Ida", "Idris", "Ilya", "Imani", "Ines",
  "Ingrid", "Iris", "Isabela", "Isamu", "Ismail", "Ivan", "Jae", "Jamila", "Jarek", "Jasmin", "Javier", "Jelena", "Jian", "Joaquin",
  "Johanna", "Jonas", "Josephine", "Juliet", "Juno", "Kabir", "Kaia", "Kaito", "Kamila", "Karim", "Kasia", "Katya", "Keanu", "Kemal",
  "Khalid", "Kiran", "Kofi", "Krishna", "Lars", "Laila", "Leila", "Leo", "Leonie", "Liana", "Lila", "Linnea", "Liron", "Lorenzo",
  "Lucia", "Ludvig", "Luka", "Mads", "Magnus", "Maha", "Maija", "Malik", "Manon", "Marek", "Margit", "Mariam", "Marisol", "Marta",
  "Mateo", "Maya", "Mehmet", "Meera", "Mikkel", "Mira", "Miriam", "Moana", "Mohan", "Nadia", "Nala", "Naomi", "Natsuki", "Nayeli",
  "Neel", "Nia", "Niamh", "Nikolai", "Nils", "Nina", "Nour", "Nuria", "Odalys", "Ola", "Oleg", "Olive", "Omar", "Ondrej", "Oona", "Orla",
  "Oskar", "Paloma", "Panagiota", "Pascal", "Patrice", "Pedro", "Petra", "Pilar", "Priya", "Quang", "Rafael", "Raisa", "Ravi", "Reza",
  "Rhea", "Ronan", "Rosa", "Rune", "Ruth", "Sadia", "Saira", "Salim", "Sanne", "Santiago", "Sarai", "Saul", "Selin", "Senna", "Shirin",
  "Sibel", "Sina", "Sofia", "Soren", "Stellan", "Suleiman", "Svea", "Tadeo", "Takumi", "Talia", "Tamar", "Tariq", "Teodora", "Thandi",
  "Theo", "Tobias", "Tomas", "Tova", "Ualani", "Ugo", "Uma", "Valentina", "Vera", "Viggo", "Vikram", "Wanjiru", "Wei", "Willem",
  "Ximena", "Yara", "Yosef", "Yuki", "Zaid", "Zara", "Zehra", "Zola"
] as const;

const FAMILY_NAMES = [
  "Abara", "Adeyemi", "Aguilar", "Ahmadi", "Ajayi", "Alberti", "Almeida", "Amari", "Andersen", "Anwar", "Aoki", "Arslan", "Asante",
  "Ashworth", "Ayala", "Bakker", "Balogun", "Banerjee", "Barros", "Bassett", "Batista", "Beaumont", "Behrens", "Bello", "Berg",
  "Bergstrom", "Bhatt", "Bianchi", "Bishara", "Blackwood", "Bogdanov", "Bonnet", "Borg", "Boulos", "Brandt", "Bulgakov", "Cabrera",
  "Calderon", "Camara", "Cardoso", "Carrington", "Castillo", "Cavanagh", "Cerny", "Chandra", "Chatterjee", "Chaudhry", "Chen", "Cheung",
  "Chowdhury", "Cisneros", "Clarke", "Cohen", "Colombo", "Conti", "Cordova", "Costa", "Cruz", "Dahl", "Dalgaard", "Daniels", "Darzi",
  "Delacroix", "Demir", "Desai", "Devlin", "Diallo", "Dimitrov", "Djalilova", "Doherty", "Dubois", "Duarte", "Eberhardt", "Ekwueme",
  "Elmi", "Engberg", "Escobar", "Estrada", "Fabbri", "Falk", "Farrow", "Fernandes", "Ferreira", "Fleischer", "Fontaine", "Forsberg",
  "Frost", "Fujimoto", "Gallagher", "Garcia", "Gauthier", "Gebre", "Gill", "Giordano", "Goldberg", "Gomes", "Grigoryan", "Gupta",
  "Gustafsson", "Haddad", "Hagen", "Halim", "Hamada", "Hansen", "Haruna", "Hassan", "Hayashi", "Heikkinen", "Herrera", "Hoffmann",
  "Horvath", "Hsu", "Ibrahim", "Iglesias", "Ikeda", "Imamura", "Ionescu", "Iqbal", "Ishikawa", "Jansen", "Jaworski", "Jensen", "Jimenez",
  "Joshi", "Kaczmarek", "Kagawa", "Kamau", "Kapoor", "Karlsson", "Katsaros", "Kaur", "Kavanagh", "Keita", "Khalil", "Kimura", "Kirchner",
  "Kobayashi", "Koirala", "Kovac", "Kruger", "Kumar", "Kwon", "Laakso", "Laurent", "Leclerc", "Lindqvist", "Lombardi", "Lopez", "Lund",
  "Machado", "Madsen", "Maeda", "Magnusson", "Mahmoud", "Makarova", "Malik", "Mancini", "Marchetti", "Marino", "Martinez", "Mbeki",
  "Medina", "Mehta", "Mendes", "Mercado", "Mikkelsen", "Milanovic", "Mitchell", "Moreau", "Morales", "Mori", "Moussa", "Mwangi",
  "Nakamura", "Narayanan", "Navarro", "Nguyen", "Nielsen", "Nkemdirim", "Norberg", "Novak", "Nowak", "Nunes", "Obi", "Ochoa", "Odugbemi",
  "Ogawa", "Okafor", "Okonjo", "Oliveira", "Olsen", "Onyeka", "Ortega", "Osei", "Ozdemir", "Padilla", "Palmer", "Pankaj", "Papadopoulos",
  "Park", "Pedersen", "Pereira", "Petrov", "Pham", "Pires", "Popescu", "Prasad", "Quintero", "Radu", "Rahman", "Ramirez", "Rao",
  "Rasmussen", "Reyes", "Ribeiro", "Richter", "Rivas", "Rocha", "Rodriguez", "Romero", "Rosenberg", "Rowntree", "Ruiz", "Saito",
  "Salazar", "Sandoval", "Sarkar", "Sasaki", "Savage", "Schneider", "Schulz", "Sellers", "Serrano", "Shah", "Sharma", "Shevchenko",
  "Silva", "Simonyan", "Singh", "Sinha", "Sokolov", "Soriano", "Sousa", "Stanescu", "Stefanou", "Strand", "Suzuki", "Svendsen", "Szabo",
  "Takahashi", "Tanaka", "Tavares", "Thanh", "Thiam", "Thorne", "Toledo", "Torres", "Tran", "Tsai", "Ueda", "Ursu", "Valenzuela",
  "Varga", "Vasquez", "Verhoeven", "Vidal", "Vogel", "Wagner", "Walsh", "Wang", "Watanabe", "Weber", "Whitfield", "Wickramasinghe",
  "Wojcik", "Wright", "Yamamoto", "Yildiz", "Yoshida", "Zabala", "Zamora", "Zhang", "Zhao", "Ziegler", "Zimmer", "Zubair"
] as const;

/** How many redraws before the loop stops fighting and disambiguates with a number instead. */
const MAX_ATTEMPTS = 64;

function pick(list: readonly string[], random: () => number): string {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))] as string;
}

/**
 * One person's name for `seed`, avoiding every name in `used`.
 *
 * The rejection loop is what stops a cohort of 25 from containing two Ingrid Bergstroms: the
 * caller passes the names it has already handed out for this cohort and keeps drawing from the
 * same stream until one lands clear. Past `MAX_ATTEMPTS` — which needs a cohort far larger than
 * the bank — it falls back to a numbered variant rather than looping forever.
 */
export function nameFrom(seed: string, used: ReadonlySet<string> = new Set()): string {
  const random = seededRandom(seed);
  let candidate = "";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    candidate = `${pick(GIVEN_NAMES, random)} ${pick(FAMILY_NAMES, random)}`;
    if (!used.has(candidate)) return candidate;
  }
  for (let suffix = 2; ; suffix++) {
    const numbered = `${candidate} ${suffix}`;
    if (!used.has(numbered)) return numbered;
  }
}

/** Names for a whole lane, in ordinal order, none of them repeated. */
export function namesForLane(seed: string, laneSlug: string, count: number): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const name = nameFrom(`${seed}:${laneSlug}:${ordinal}`, used);
    used.add(name);
    out.push(name);
  }
  return out;
}

/**
 * The email local part for one person. Lane-scoped, which is the fix for
 * `slugify(persona.id)-${ordinal + 1}`: that collided the moment two cohorts shared a persona, and
 * a colliding signup email means the second cohort cannot make an account at all. The lane's dot
 * is kept: a dot inside a local part is legal everywhere, and the handle reads like the id.
 *
 * MINTED HERE, ONCE, by the roster writer. Everything downstream — expansion, the config snapshot,
 * the signup provider — carries the value rather than calling this again, so a handle that did not
 * come from here still reaches the account (SPEC §5.3.5).
 */
export function handleFor(name: string, laneSlug: string, ordinal: number): string {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "person"}-${laneSlug}-${ordinal + 1}`;
}
