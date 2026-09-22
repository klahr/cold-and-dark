import type { ControlDef } from '../../aircraft/types';
import type { FaultCode } from '../../sim/Faults';
import type { Simulation } from '../../sim/Simulation';
import type { ControlDescription } from '../overlay';

/**
 * Swedish for a six-year-old who can read.
 *
 * Every word on screen is here. The checklist underneath is the POH's own,
 * in POH English, and nothing is dropped from it — a shorter list would
 * teach a shorter procedure — but every callout becomes a thing to *do*,
 * and every "why" becomes one short sentence with a reason a child cares
 * about.
 *
 * Rules the copy follows, because they are what makes it readable at six:
 * short sentences, one instruction each; no subordinate clauses; concrete
 * nouns ("den röda knappen") over cockpit names ("mixture"); and the reason
 * always answers "what happens if I don't", never "what the system does".
 */
export interface KidStep {
  /** Picture cue, so the step is recognisable before it is read. */
  icon: string;
  /** What this step is, in three or four words. */
  title: string;
  /** How to physically do it. */
  action: string;
  /** Why it matters, in one sentence. */
  why: string;
}

/**
 * Keyed by checklist item id. `tests/kid-copy.test.ts` asserts there is an
 * entry for every item of every registered aircraft, and nothing left over
 * for a step that no longer exists.
 */
export const KID_STEPS: Record<string, KidStep> = {
  /* ------------------- Before starting engine ------------------- */
  seats: {
    icon: '💺',
    title: 'Lås fast stolen',
    action: 'Tryck ner spaken som sitter nere vid stolen.',
    why: 'Annars kan stolen glida bakåt när planet åker fort — och då följer ratten med.',
  },
  belts: {
    icon: '🎽',
    title: 'Sätt på bältet',
    action: 'Klicka på bältesspännet bredvid dig.',
    why: 'Bältet håller kvar dig i stolen, precis som i bilen.',
  },
  doors: {
    icon: '🚪',
    title: 'Stäng dörren',
    action: 'Klicka på dörrhandtaget till vänster om dig.',
    why: 'En dörr som åker upp i luften låter jättemycket och går nästan inte att stänga igen.',
  },
  'brakes-set': {
    icon: '🅿️',
    title: 'Dra åt bromsen',
    action: 'Dra ut bromsknappen. Håll in musknappen och dra neråt.',
    why: 'Motorn drar planet framåt så fort den startar. Bromsen håller planet kvar på plats.',
  },
  'fuel-both': {
    icon: '⛽',
    title: 'Vrid bensinkranen till BOTH',
    action: 'Titta ner mot golvet och klicka på kranens högra sida tills handtaget pekar på BOTH.',
    why: 'BOTH betyder båda. Då rinner bensin ner från tanken i båda vingarna.',
  },
  'avionics-off': {
    icon: '📻',
    title: 'Stäng av radion',
    action: 'Fäll ner brytaren som heter AVIONICS.',
    why: 'När motorn startar hoppar strömmen till. Radion mår bäst av att sova just då.',
  },
  'breakers-in': {
    icon: '🔘',
    title: 'Hitta knappen som sticker ut',
    action: 'Titta på raden med små runda knappar. Sticker någon ut? Klicka på den!',
    why: 'Varje liten knapp är en säkring. Sticker en ut är den saken den styr helt död.',
  },

  /* --------------------- Starting the engine --------------------- */
  'mixture-rich': {
    icon: '🔴',
    title: 'Tryck in den röda knappen',
    action: 'Håll in musknappen på den röda knappen och dra uppåt tills den är helt inne.',
    why: 'Den röda knappen släpper fram bensin. Är den utdragen snurrar motorn hur länge som helst utan att starta.',
  },
  'carb-heat-cold': {
    icon: '❄️',
    title: 'Tryck in CARB HEAT',
    action: 'Dra uppåt på handtaget som heter CARB HEAT tills det är helt inne.',
    why: 'Det handtaget tar varm luft från motorn. På marken skulle det suga in damm och grus.',
  },
  'master-on': {
    icon: '🔋',
    title: 'Slå på strömmen',
    action: 'Fäll upp båda halvorna av den stora röda brytaren.',
    why: 'Nu vaknar planet. Brytaren har två halvor och båda ska upp — en till batteriet, en till laddningen.',
  },
  'beacon-on': {
    icon: '🚨',
    title: 'Tänd blinkljuset',
    action: 'Fäll upp den lilla brytaren som det står BCN under.',
    why: 'Blinkljuset säger till alla utanför: passa er, nu börjar propellern snurra!',
  },
  prime: {
    icon: '💧',
    title: 'Pumpa in bensin',
    action: 'Dra knappen PRIMER hela vägen ut och tryck in den igen. Gör så tre gånger.',
    why: 'Motorn är kall och behöver lite extra bensin för att vakna. Men pumpa inte mer än sex gånger — då blir den dränkt.',
  },
  'throttle-crack': {
    icon: '🚦',
    title: 'Ge lite gas',
    action: 'Dra uppåt på den svarta gasknappen — bara en pytteliten bit.',
    why: 'Motorn behöver lite luft för att starta. Men bara lite, annars rusar den igång alldeles för fort.',
  },
  'prop-clear': {
    icon: '👀',
    title: 'Titta efter folk',
    action: 'Dra med musen och titta ut genom fönstret till vänster. Titta sedan ut åt höger.',
    why: 'En propeller som snurrar är nästan osynlig. Därför måste man titta först — på riktigt.',
  },
  start: {
    icon: '🔑',
    title: 'Vrid om nyckeln',
    action: 'Klicka på nyckelns högra sida tills det står BOTH. Tryck sedan och HÅLL KVAR. Släpp så fort motorn går!',
    why: 'Nyckeln drar runt motorn tills den tänder. Håller du kvar när motorn redan går skaver startmotorn sönder sig.',
  },
  'oil-pressure': {
    icon: '🛢️',
    title: 'Kolla oljetrycket',
    action: 'Titta på mätaren där det står OIL PRESS. Nålen ska klättra upp i det gröna.',
    why: 'Oljan smörjer motorn. Kommer nålen inte upp får motorn inte gå — då går den sönder inifrån.',
  },
  'warm-idle': {
    icon: '🎚️',
    title: 'Ställ in 1000 varv',
    action: 'Dra försiktigt i gasknappen tills den stora mätaren visar ungefär 1000.',
    why: 'Då snurrar motorn lugnt och hinner bli varm i sin egen takt.',
  },
  'avionics-on': {
    icon: '📻',
    title: 'Slå på radion igen',
    action: 'Fäll upp brytaren som heter AVIONICS.',
    why: 'Starten är klar, så nu är det tryggt att väcka radion.',
  },
  'ammeter-check': {
    icon: '⚡',
    title: 'Kolla att det laddar',
    action: 'Titta på mätaren AMMETER. Nålen ska peka lite åt plus-sidan.',
    why: 'Motorn fyller på batteriet igen, precis som en laddare till en surfplatta.',
  },

  /* ---------------------- Securing the aeroplane ---------------------- */
  'shutdown-throttle': {
    icon: '🎚️',
    title: 'Ställ in 1000 varv',
    action: 'Ställ gasen så att den stora mätaren visar ungefär 1000.',
    why: 'Motorn får svalna en liten stund innan den stängs av, så den inte får en kalldusch.',
  },
  'shutdown-avionics': {
    icon: '📻',
    title: 'Stäng av radion',
    action: 'Fäll ner brytaren som heter AVIONICS.',
    why: 'Samma sak som vid starten: radion ska sova när strömmen bråkar.',
  },
  'shutdown-mixture': {
    icon: '🔴',
    title: 'Dra ut den röda knappen',
    action: 'Dra neråt på den röda knappen hela vägen ut. Vänta tills motorn tystnar.',
    why: 'Ett flygplan stängs av genom att motorn inte får mer bensin. Då finns inget kvar som kan tända av misstag.',
  },
  'shutdown-mags': {
    icon: '🔑',
    title: 'Vrid nyckeln till OFF',
    action: 'Klicka på nyckelns vänstra sida tills det står OFF.',
    why: 'Motorn gör sin egen gnista och bryr sig inte om strömmen. Först vid OFF är propellern ofarlig.',
  },
  'shutdown-master': {
    icon: '🔋',
    title: 'Stäng av strömmen',
    action: 'Fäll ner båda halvorna av den stora röda brytaren.',
    why: 'Annars är batteriet tomt till imorgon.',
  },
};

export function kidStep(itemId: string): KidStep | null {
  return KID_STEPS[itemId] ?? null;
}

/* ------------------------------------------------------------------ */
/* Mistakes                                                            */
/* ------------------------------------------------------------------ */

/**
 * The same faults the expert HUD shows, said kindly. A six-year-old who
 * floods the engine should hear what to do next, not what they did wrong,
 * so every message ends with the fix.
 */
export const KID_FAULTS: Record<FaultCode, { title: string; message: string }> = {
  'no-power': {
    title: 'Ingen ström',
    message: 'Planet är strömlöst. Fäll upp båda halvorna av den stora röda brytaren först.',
  },
  'mixture-cutoff': {
    title: 'Motorn får ingen bensin',
    message: 'Den röda knappen är utdragen. Tryck in den helt, så kommer bensinen fram.',
  },
  'fuel-off': {
    title: 'Bensinkranen är stängd',
    message: 'Vrid kranen nere vid golvet till BOTH, annars tystnar motorn om en stund.',
  },
  'fuel-starvation': {
    title: 'Bensinen tog slut',
    message: 'Motorn fick ingen ny bensin. Vrid kranen till BOTH och prova igen.',
  },
  'mags-off': {
    title: 'Ingen gnista',
    message: 'Nyckeln måste stå på BOTH innan motorn kan tända.',
  },
  'not-primed': {
    title: 'För lite bensin',
    message: 'Den kalla motorn vill ha mer. Pumpa PRIMER ett par gånger till och prova igen.',
  },
  flooded: {
    title: 'Motorn är dränkt',
    message:
      'Det blev för mycket bensin. Så här räddar du den: dra ut den röda knappen helt, tryck in gasen helt, vrid om nyckeln och tryck sakta in den röda knappen igen.',
  },
  'battery-low': {
    title: 'Batteriet blir trött',
    message: 'Många försök i rad tar hårt på batteriet. Vila en liten stund innan nästa försök.',
  },
  'battery-flat': {
    title: 'Batteriet är slut',
    message: 'Nu finns ingen ström kvar alls. Tryck på "Börja om" så får du ett nyladdat plan.',
  },
  'starter-hot': {
    title: 'Startmotorn blev varm',
    message: 'Den orkar inte mer just nu. Vänta en liten stund så svalnar den.',
  },
  'starter-while-running': {
    title: 'Släpp nyckeln!',
    message: 'Motorn går redan. Släpp nyckeln direkt när du hör den starta.',
  },
  'no-oil-pressure': {
    title: 'Oljan kommer inte fram',
    message: 'Nålen på OIL PRESS kom aldrig upp. Stäng av motorn — den mår inte bra.',
  },
  'throttle-too-far': {
    title: 'För mycket gas',
    message: 'Gasknappen är för långt inne. Dra ut den nästan hela vägen innan du startar.',
  },
  'low-voltage': {
    title: 'Det laddar inte',
    message: 'Kolla att båda halvorna av den stora röda brytaren är uppfällda.',
  },
};

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

/**
 * Swedish names for the things you can touch. A control with no entry gets
 * no tooltip in kid mode at all: an English cockpit label popping up beside
 * a Swedish instruction is worse than silence.
 */
export const KID_CONTROL_NAMES: Record<string, string> = {
  masterBattery: 'Strömmen (batteriet)',
  masterAlternator: 'Strömmen (laddningen)',
  magKey: 'Startnyckeln',
  fuelSelector: 'Bensinkranen',
  mixture: 'Röda knappen',
  throttle: 'Gasen',
  carbHeat: 'Varmluften',
  primer: 'Bensinpumpen PRIMER',
  fuelPump: 'Bensinpumpen',
  parkingBrake: 'Parkeringsbromsen',
  avionicsMaster: 'Strömmen till radion',
  beacon: 'Blinkljuset',
  landingLight: 'Landningsljuset',
  taxiLight: 'Körljuset',
  navLights: 'Positionsljusen',
  strobes: 'Blixtljusen',
  pitotHeat: 'Värmen till fartmätaren',
  seatLatch: 'Stolens lås',
  seatbelt: 'Bältet',
  cabinDoor: 'Dörren',
  flaps: 'Klaffarna',
  elevatorTrim: 'Trimhjulet',
  cabinHeat: 'Värmen i kabinen',
  cabinAir: 'Friska luften',
};

/** Hover read-out in kid mode, or null for anything without a Swedish name. */
export function describeControlInSwedish(
  def: ControlDef,
  sim: Simulation,
): ControlDescription | null {
  const name = def.id.startsWith('brk') ? 'En säkring' : KID_CONTROL_NAMES[def.id];
  if (!name) return null;

  const v = sim.controls.num(def.id);
  switch (def.kind) {
    case 'toggle':
      return { title: name, value: v > 0.5 ? 'PÅ' : 'AV' };
    case 'breaker':
      return { title: name, value: v > 0.5 ? 'intryckt' : 'sticker ut' };
    case 'selector':
    case 'key':
      return { title: name, value: sim.controls.pos(def.id) };
    case 'wheel':
      return { title: name, value: `${Math.round(v * 100)} %` };
    case 'pushPull':
      if (def.id === 'primer') {
        const n = sim.fuel.primerStrokes;
        return {
          title: name,
          value: n === 0 ? 'inte pumpad än' : `pumpad ${n} ${n === 1 ? 'gång' : 'gånger'}`,
        };
      }
      return { title: name, value: pushPullInSwedish(def.id, v) };
  }
}

function pushPullInSwedish(id: string, v: number): string {
  if (id === 'mixture') {
    if (v > 0.95) return 'inne — full bensin';
    if (v < 0.1) return 'ute — ingen bensin';
    return 'halvvägs';
  }
  if (id === 'throttle') {
    if (v < 0.03) return 'ute — ingen gas';
    if (v > 0.95) return 'inne — full gas';
    return 'lite gas';
  }
  if (id === 'parkingBrake') return v < 0.3 ? 'åtdragen' : 'släppt';
  if (v > 0.9) return 'helt inne';
  if (v < 0.1) return 'helt ute';
  return 'halvvägs';
}

/* ------------------------------------------------------------------ */
/* Everything else on screen                                           */
/* ------------------------------------------------------------------ */

export const KID_UI = {
  title: 'Starta flygplanet!',
  subtitle: 'Gör ett steg i taget. Du klarar det!',
  sectionBefore: 'Gör dig klar',
  sectionStart: 'Nu startar vi motorn',
  sectionSecure: 'Stäng av planet',
  showMe: '👉 Var är den?',
  why: '🤔 Varför då?',
  hideWhy: 'Stäng',
  reset: 'Börja om',
  sound: 'Ljud',
  vr: 'VR-glasögon',
  inVr: 'Du är i VR',
  vrHint: 'Vrid vänster handled mot dig för att se listan.',
  stepOf: (n: number, total: number) => `Steg ${n} av ${total}`,
  stuck: 'Fastnat? Tryck på "Var är den?" så visar jag.',
  allDone: 'Klart! Planet är avstängt och sover.',
  goalKicker: 'MOTORN GÅR!',
  goalTitle: 'Du startade flygplanet!',
  goalBody: 'Precis som en riktig pilot. Vill du stänga av det också?',
  goalContinue: 'Ja, stäng av planet',
  goalAgain: '↺ Starta en gång till',
  wrongControl: (wanted: string) => `Inte den än! Först ska du: ${wanted}.`,
  alreadyDone: 'Den är klar! Den ska stå kvar så.',
} as const;

/** Rotated so the hundredth tick still feels like someone noticed. */
export const KID_PRAISE: readonly string[] = [
  'Bra jobbat!',
  'Snyggt!',
  'Precis rätt!',
  'Toppen!',
  'Du är grym på det här!',
  'Perfekt!',
  'Ja! Så ska det se ut.',
];
