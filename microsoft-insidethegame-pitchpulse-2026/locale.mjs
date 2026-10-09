/**
 * Evidence-linked narrative localization for synthetic PitchPulse events.
 * Facts/proof remain MatchEngine outputs. Presentation-only templates: no
 * remote translation, model request, ledger mutation, or Microsoft-AI claim.
 */
const TEAMS = ['Harbor FC', 'Valley FC'];
export const STORY_LANGUAGES = Object.freeze(['en', 'es', 'pt']);
const PHRASES = Object.freeze({
  en: {
    goal: team => team + ' score!',
    chance: team => team + ' create a shot',
    pressure: team => team + ' step up the pressure',
    turnover: team => team + ' win a challenge',
    shots: (team,m) => m.shots.value + ' shot(s) in the match, ' +
      m.shotsOnTarget.value + ' on target. ' + m.recentShots.value +
      ' shot(s) in the rolling five-minute window.',
    highPressures: (team,m) => m.recentHighPressures.value +
      ' high-pressure event(s) for ' + team + ' in the last five minutes.',
    tackles: (team,m) => m.tacklesWon.value + ' successful tackle(s) for ' +
      team + ' so far.',
    ownFan: 'Your side have changed the moment.',
    otherFan: favorite => "Here's what it means for " + favorite +
      ': the other side have an opportunity.',
  },
  es: {
    goal: team => '¡Gol de ' + team + '!',
    chance: team => team + ' genera un disparo',
    pressure: team => team + ' intensifica la presión',
    turnover: team => team + ' gana un duelo',
    shots: (team,m) => m.shots.value + ' tiros de ' + team +
      ' en el partido, ' + m.shotsOnTarget.value + ' a puerta. ' +
      m.recentShots.value + ' tiros en los últimos cinco minutos.',
    highPressures: (team,m) => m.recentHighPressures.value +
      ' acciones de presión alta de ' + team + ' en los últimos cinco minutos.',
    tackles: (team,m) => m.tacklesWon.value + ' entradas ganadas por ' +
      team + ' hasta ahora.',
    ownFan: 'Tu equipo ha cambiado este momento.',
    otherFan: favorite => 'Para quienes siguen a ' + favorite +
      ': el rival dispone de una oportunidad.',
  },
  pt: {
    goal: team => 'Gol do ' + team + '!',
    chance: team => team + ' cria uma finalização',
    pressure: team => team + ' aumenta a pressão',
    turnover: team => team + ' vence uma disputa',
    shots: (team,m) => m.shots.value + ' finalizações do ' + team +
      ' na partida, ' + m.shotsOnTarget.value + ' no alvo. ' +
      m.recentShots.value + ' finalizações nos últimos cinco minutos.',
    highPressures: (team,m) => m.recentHighPressures.value +
      ' ações de pressão alta do ' + team + ' nos últimos cinco minutos.',
    tackles: (team,m) => m.tacklesWon.value +
      ' desarmes bem-sucedidos do ' + team + ' até agora.',
    ownFan: 'Seu time mudou o momento da partida.',
    otherFan: favorite => 'Para os torcedores do ' + favorite +
      ': o adversário tem uma oportunidade.',
  },
});

function metricsFor(moment) {
  if (moment.kind === 'goal' || moment.kind === 'chance')
    return ['shots','shotsOnTarget','recentShots'];
  if (moment.kind === 'pressure') return ['recentHighPressures'];
  if (moment.kind === 'turnover') return ['tacklesWon'];
  return null;
}

/** Unknown event/proof fails closed to the original English text. */
export function localizeMoment(moment, mode, requestedLanguage='en') {
  const language = STORY_LANGUAGES.includes(requestedLanguage)
    ? requestedLanguage : 'en';
  if (language === 'en') return moment;
  if (!moment || typeof moment !== 'object' || typeof moment.title !== 'string')
    return moment;
  if (!['goal','chance','pressure','turnover'].includes(moment.kind)) return moment;
  const team = TEAMS.find(name => moment.title.startsWith(name + ' ') ||
    moment.title === name + ' score!');
  if (!team) return moment;
  const keys = metricsFor(moment);
  const metrics = moment.proof?.metrics;
  if (!keys || keys.some(k => !Number.isSafeInteger(metrics?.[k]?.value) ||
    metrics[k].value < 0)) return moment;
  const dict = PHRASES[language];
  const title = dict[moment.kind](team);
  const why = moment.kind === 'goal' || moment.kind === 'chance'
    ? dict.shots(team, metrics) : moment.kind === 'pressure'
      ? dict.highPressures(team, metrics) : dict.tackles(team, metrics);
  const isFan = mode?.audience === 'fan';
  const favorite = TEAMS.includes(mode?.favorite) ? mode.favorite : null;
  const text = isFan && favorite
    ? title + ' ' + (team === favorite ? dict.ownFan : dict.otherFan(favorite))
    : title + ' ' + why;
  return {...moment, title, text, why, presentationLanguage:language};
}

/** A view of original state: scoreboard, event IDs and proof objects unchanged. */
export function localizedStory(state, requestedLanguage='en') {
  const language = STORY_LANGUAGES.includes(requestedLanguage)
    ? requestedLanguage : 'en';
  if (language === 'en') return state;
  return {
    ...state,
    overlays: state.overlays.map(o => localizeMoment(o, state.mode, language)),
    activeOverlays: state.activeOverlays.map(o => localizeMoment(o, state.mode, language)),
    presentationLanguage: language,
  };
}
