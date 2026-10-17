import { AvatarStrategy } from "./AvatarStrategy.js";

const NOT_FOUND_TTL = 60 * 60 * 1000; // 1 hour

export class ContactsStrategy extends AvatarStrategy {
  constructor(fetcher, mail) {
    super(fetcher);
    this.mail = mail;
  }

  async fetchAvatar() {
    const email = this.mail.getEmail();

    const missTs = ContactsStrategy._notFoundCache.get(email);
    if (missTs !== undefined && Date.now() - missTs < NOT_FOUND_TTL) {
      return null;
    }

    try {
      const contacts = await messenger.contacts.quickSearch(email);
      if (contacts.length > 0) {
        const contact = contacts[0];
        const photo = await messenger.contacts.getPhoto(contact.id);
        if (photo) {
          return photo;
        }
      }
    } catch (error) {
      console.error("Error fetching avatar from contacts", error);
    }
    ContactsStrategy._notFoundCache.set(email, Date.now());
    return null;
  }
}

/** @type {Map<string, number>} email → timestamp of last "not found" result */
ContactsStrategy._notFoundCache = new Map();
