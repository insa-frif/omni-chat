import * as Bluebird from "bluebird";

import {User} from "./interfaces/user";
import {Discussion} from "./interfaces/discussion";
import {ContactAccount} from "./interfaces/contact-account";
import {Subdiscussion} from "./interfaces/group-chat";
import {GroupChat} from "./interfaces/group-chat";
import {Message} from "palantiri-interfaces";

export class OChatDiscussion implements Discussion {
  creationDate: Date;

  name: string;

	description: string;

  heterogeneous: boolean;
	
	subdiscussions: Subdiscussion[];

  owner: User;

  getMessages(maxMessages: number, afterDate?: Date, filter?: (msg: Message) => boolean): Bluebird<Message[]> {
	  let messages: Message[] = [];
    // TODO : this depends on how we manage heterogeneous ContactAccount
    //        see in OchatUser.getOrCreateDiscussion
    // NOTES : as discussed, the best for heterogeneous Discussions is to just getMessage
    //         not older than the creationDate of the discussion.
    //         In an extreme case, we can let the user did it, but he will then have to
    //         give us a method that merge messages, because it has no semantic for us.
    return Bluebird.resolve(messages);
  }

	addSubdiscussion(subdiscuss: GroupChat): Bluebird.Thenable<Discussion> {
		// TODO : rework all of this. This is probably wrong now
		if(this.subdiscussions.indexOf({since: undefined, discussion: subdiscuss}) === -1) {
			let param: string[] = [subdiscuss.protocol];
			this.owner.getAccounts(param).then((ownerAccounts) => {
				let compatibleSubdiscussions: GroupChat[] = [];
				for(let subdiscussion of this.subdiscussions) {
					if(subdiscussion.discussion.protocol === subdiscuss.protocol) {
						compatibleSubdiscussions.push(subdiscuss);
					}
				}
				let gotIt: boolean = false;
				for(let compatibleParticipant of compatibleSubdiscussions) {
					for(let ownerAccount of ownerAccounts) {
						if(ownerAccount.hasContactAccount(compatibleParticipant.participants[0])) {
							// Ok, we have determined which one of the user's accounts
							// owns the current compatible participant.
							// Now if it owns the ContactAccounts that we want to add
							// to this discussion too, we win.
							if(ownerAccount.hasContactAccount(subdiscuss.participants[0])) {
								// That's it, we win !
								// TODO : well, almost. We need to check if every member is accessible,
								//        or it could lead to some problems.
								ownerAccount.getOrCreateConnection()
									.then((co) => {
										return co.getConnectedApi();
									})
									.then((api) => {
										api.addMembersToDiscussion(subdiscuss.participants, compatibleParticipant, (err) => {
											if(!err) {
												compatibleParticipant.addParticipants(subdiscuss.participants);
											}
										});
									});
								gotIt = true;
								break;
							}
						}
					}
					if(gotIt) {
						break;
					}
				}
				// In the case where we still not have been able to add these participants,
				// there is two solutions :
				if(!gotIt) {
					let currentDate = new Date();
					if(compatibleSubdiscussions.length === 0) {
						// First, we are trying to add accounts using a protocol which is
						// not in this discussion yet. We just have to add these participants
						// to this discussion, which will become heterogeneous.
						this.subdiscussions.push({since: currentDate, discussion: subdiscuss});
						this.heterogeneous = true;
					} else {
						// Second, we are trying to add accounts from an UserAccount which has
						// no current contacts in this discussion. We just have to add them.
						this.subdiscussions.push({since: currentDate, discussion: subdiscuss});
					}
					let that = this;
					subdiscuss.owner.connection.on("msgRcv", (msg: Message) => {
						let sender = msg.author;
						let foundSender: boolean = false;
						for(let subdiscussion of that.subdiscussions) {
							if(!foundSender) {
								for(let contact of subdiscussion.discussion.participants) {
									if(sender === contact) {
										foundSender = true;
										break;
									}
								}
							}
							if(!foundSender) {
								subdiscussion.discussion.owner.sendMessage(msg, subdiscussion.discussion);
							}
						}
					});
					// TODO : but how the new participants will know that they are in this discussion ?
					//        For the moment, they won't know until we send a message to them.
					//        I don't think that it is a real problem.
					//        If it is, we coud just auto-send a message to them.
				}
			});
		}
		return Bluebird.resolve(this);
	}

  removeParticipants(contactAccount: ContactAccount): Bluebird<Discussion> {
    // TODO
    return Bluebird.resolve(this);
  }

  getSubdiscussions(): Bluebird<Subdiscussion[]> {
    return Bluebird.resolve(this.subdiscussions);
  }

  getName(): string {
    return this.name;
  }

  getDescription(): string {
    return this.description;
  }
}
