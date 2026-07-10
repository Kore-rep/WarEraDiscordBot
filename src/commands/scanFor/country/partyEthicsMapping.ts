import type { APIApplicationCommandOptionChoice } from 'discord.js';

/** Ethics axes on `PartyDTO.ethics` from warera-sdk */
export type PartyEthicsAxis = 'industrialism' | 'imperialism' | 'militarism' | 'isolationism';

export interface EthicAxisValue {
  axis: PartyEthicsAxis;
  value: number;
}

/**
 * A resolved scan target: either a position on an ethics axis, or the standalone
 * `unethical` boolean flag on `PartyDTO.ethics`.
 */
export type EthicTarget =
  | ({ kind: 'axis' } & EthicAxisValue)
  | { kind: 'unethical'; value: boolean };

/**
 * Display labels for ruling-party ethics. Values are -2, -1, 1, or 2 per axis.
 * Must stay in sync with game + Discord slash choices.
 */
export const ETHIC_LABEL_TO_AXIS_VALUE: Record<string, EthicAxisValue> = {
  'Fanatic Industrialist': { axis: 'industrialism', value: 2 },
  Industrialist: { axis: 'industrialism', value: 1 },
  Agrarian: { axis: 'industrialism', value: -1 },
  'Fanatic Agrarian': { axis: 'industrialism', value: -2 },

  'Fanatic Imperialist': { axis: 'imperialism', value: 2 },
  Imperialist: { axis: 'imperialism', value: 1 },
  Republican: { axis: 'imperialism', value: -1 },
  'Fanatic Republican': { axis: 'imperialism', value: -2 },

  'Fanatic Expansionist': { axis: 'militarism', value: 2 },
  Militarist: { axis: 'militarism', value: 1 },
  Pacifist: { axis: 'militarism', value: -1 },
  'Fanatic Pacifist': { axis: 'militarism', value: -2 },

  'Fanatic Diplomatic': { axis: 'isolationism', value: 2 },
  Diplomatic: { axis: 'isolationism', value: 1 },
  Isolationist: { axis: 'isolationism', value: -1 },
  'Fanatic Isolationist': { axis: 'isolationism', value: -2 }
};

/** Labels that filter on the standalone `unethical` boolean rather than an axis. */
export const ETHIC_LABEL_TO_UNETHICAL: Record<string, boolean> = {
  Unethical: true,
  Ethical: false,
};

/** Slash choices (alphabetical). Discord allows at most 25 per option; we have 18. */
export const ETHIC_SLASH_CHOICES: APIApplicationCommandOptionChoice<string>[] = [
  ...Object.keys(ETHIC_LABEL_TO_AXIS_VALUE),
  ...Object.keys(ETHIC_LABEL_TO_UNETHICAL),
]
  .sort((a, b) => a.localeCompare(b))
  .map(label => ({ name: label, value: label }));

export function resolveEthicLabel(label: string): EthicTarget | undefined {
  const axis = ETHIC_LABEL_TO_AXIS_VALUE[label];
  if (axis) {
    return { kind: 'axis', ...axis };
  }
  if (label in ETHIC_LABEL_TO_UNETHICAL) {
    return { kind: 'unethical', value: ETHIC_LABEL_TO_UNETHICAL[label] };
  }
  return undefined;
}
