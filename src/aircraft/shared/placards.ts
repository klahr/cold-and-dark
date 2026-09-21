import type { PanelPlacard } from '../types';

/**
 * The lettering that is printed on a 172 panel but belongs to no switch.
 *
 * A real panel is dense with text: the registration above the instruments,
 * limitation placards, operating notes, section headings over each group of
 * switches. Rendered cockpits almost always omit it, and its absence is one
 * of the clearest signals that you are looking at a model rather than a
 * machine. It is also nearly free — all of it lands on the single
 * silkscreen texture.
 */
export function panelPlacards(registration: string): PanelPlacard[] {
  return [
    // Registration, centred above the pilot's instruments.
    { text: registration, x: -0.345, y: 0.243, size: 0.0072 },

    // Operating placards, in the places Cessna actually put them.
    { text: 'SMOKING PROHIBITED', x: 0.352, y: 0.238, size: 0.0056 },
    { text: 'THIS AIRCRAFT MUST BE OPERATED IN', x: 0.352, y: 0.048, size: 0.0036 },
    { text: 'COMPLIANCE WITH THE APPROVED', x: 0.352, y: 0.036, size: 0.0036 },
    { text: 'FLIGHT MANUAL PLACARDS AND MARKINGS', x: 0.352, y: 0.024, size: 0.0036 },

    { text: 'MAXIMUM DEMONSTRATED CROSSWIND', x: 0.085, y: -0.246, size: 0.0032 },
    { text: 'VELOCITY IS 15 KNOTS', x: 0.085, y: -0.256, size: 0.0032 },
    { text: 'AVOID SLIPS WITH FLAPS EXTENDED', x: 0.300, y: -0.248, size: 0.0032 },

    // Headings over the switch groups. These sit clear of the switch levers,
    // which stand proud of the panel far enough to mask anything printed
    // immediately above them.
    { text: 'MASTER', x: -0.377, y: -0.118, size: 0.0042 },
    { text: 'LIGHTS', x: -0.158, y: -0.118, size: 0.0042 },
    { text: 'CIRCUIT BREAKERS', x: 0.355, y: 0.195, size: 0.0042 },
    { text: 'ENGINE', x: -0.055, y: 0.212, size: 0.0038 },
  ];
}
