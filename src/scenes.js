// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+). The text
// fields are rendered by Gladys first, so a scene variable fits
// (`{{triggerEvent.data.title}}`, a sensor value…).
//
//   - `create_ticket`: open a ticket, requested by the user of the token (a
//     leak detected, a freezer too warm, a printer out of toner);
//   - `add_followup`: add a follow-up to a ticket (the device came back, the
//     ticket created earlier in the scene gets the news).
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async create_ticket(hub, { fields = {} }) {
    const { id, url } = await hub.createTicket(fields);
    return { ticket_id: id, url };
  },

  async add_followup(hub, { fields = {} }) {
    const { id, title } = await hub.addFollowup(fields);
    return { ticket_id: id, title };
  },
};
