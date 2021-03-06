import * as Bluebird from "bluebird";
import * as palantiri from "palantiri-interfaces";
import * as _ from "lodash";
import {EventEmitter} from "events";
import {Incident} from "incident";

import {UserInterface} from "./interfaces/user";
import {UserAccountInterface} from "./interfaces/user-account";
import {ContactAccountInterface} from "./interfaces/contact-account";
import {DiscussionInterface} from "./interfaces/discussion";
import {SimpleDiscussion} from "./simple-discussion";
import {MetaDiscussion} from "./meta-discussion";
import {GetDiscussionsOptions} from "./interfaces/user";

export class User extends EventEmitter implements UserInterface {
  /**
   * A human-readable name.
   */
  protected globalUsername: string;

  /**
   * The list of accounts associated with this user.
   */
  protected accounts: UserAccountInterface[];

  constructor (username: string) {
    super();
    this.globalUsername = username;
    this.accounts = [];
  }

  /**
   * Return the global name of this user.
   */
  getName(): Bluebird.Thenable<string> {
    return Bluebird.resolve(this.globalUsername);
  }
  /**
   * Get an existing discussion with exactly all the contact accounts
   * given in parameters, or create one if none exists.
   */
  getOrCreateDiscussion(contactAccounts: ContactAccountInterface[]): Bluebird<DiscussionInterface> {
    let contactsIDs: palantiri.AccountGlobalId[] = [];
    let rightUser: UserAccountInterface = null;
    let heterogeneous: boolean = false;
    return Bluebird
      .map(contactAccounts, (contact: ContactAccountInterface) => {
        return contact.getGlobalId();
      })
      .then((ids: palantiri.AccountGlobalId[]) => {
        contactsIDs = ids;
        return this.getAccounts();
      })
      .then((userAccounts: UserAccountInterface[]) => {
        return Bluebird
          .map(userAccounts, (account: UserAccountInterface) => {
            return account.getContactAccounts()
              .then((contactAccounts: ContactAccountInterface[]) => {
                return Bluebird.map(contactAccounts, (contact: ContactAccountInterface) => {
                  return contact.getGlobalId();
                });
              })
              .then((ids: palantiri.AccountGlobalId[]) => {
                return {user: account, contactsIDs: ids};
              });
          });
      })
      .then((fullUserAccounts: {user: UserAccountInterface, contactsIDs: palantiri.AccountGlobalId[]}[]) => {
        for(let userAccount of fullUserAccounts) {
          for(let contactID of contactsIDs) {
            if(userAccount.contactsIDs.indexOf(contactID) >= 0) {
              if(rightUser && rightUser !== userAccount.user) {
                heterogeneous = true;
                break;
              } else {
                rightUser = userAccount.user;
              }
            }
          }
          if(heterogeneous) {
            break;
          }
        }
        if(!rightUser) {
          return Bluebird.reject(new Incident("One of the contacts is unknown by the current user."));
        }
      })
      // That's it : now we know if the discussion is heterogeneous or not.
      // We just have to get one, or to create one if it does not exist.
      .then(() => {
        if(heterogeneous) {
          // TODO: access database and get the meta-discussions
          //       then get the right one or create it
	        // Let's say we haven't found it
	        return Bluebird.try(() => {
		        let discussion: DiscussionInterface = new MetaDiscussion(this);
		        return Bluebird.all(_.map(contactAccounts, (contactAccount: ContactAccountInterface) => {
			        return discussion.addParticipant(contactAccount);
		        }))
			      .thenReturn(discussion);
	        })
        } else {
          return rightUser.getOrCreateDiscussion(contactAccounts);
        }
      });
  }

  /**
   * Return all the discussions of the current user :
   * the meta discussions,
   * the simple ones,
   * accordingly to the options given.
   */
	getAllDiscussions(options?: GetDiscussionsOptions): Bluebird<DiscussionInterface[]> {
    let discussions: DiscussionInterface[] = [];
    return Bluebird
      .resolve(this.getAllSimpleDiscussions(options))
      .then((simpleDiscussions: SimpleDiscussion[]) => {
        discussions = simpleDiscussions;
        return this.getAllMetaDiscussions(options);
      })
      .then((metaDiscussions: MetaDiscussion[]) => {
        _.concat(discussions, metaDiscussions);
        return discussions;
      })
	}


  /**
   * Return all the simple-discussions for the current user,
   * or those accordingly to the options parameter.
   */
  getAllSimpleDiscussions(options?: GetDiscussionsOptions): Bluebird<SimpleDiscussion[]> {
    let discussions: SimpleDiscussion[] = [];
    return Bluebird.all(_.map(this.accounts, (account: UserAccountInterface) => {
      let counter: number = 0;
      return Bluebird.resolve(account.getDiscussions())
        .filter((discuss: DiscussionInterface) => {
          if(options) {
            let boolReturn: boolean = true;
            if(options.filter) {
              boolReturn = options.filter(discuss);
            }
            if(options.max && boolReturn) {
              counter++;
              if(counter > options.max) {
                boolReturn = false;
              }
            }
            return boolReturn;
          } else {
            return true;
          }
        })
        .then((discuss: DiscussionInterface[]) => {
          _.concat(discussions, <SimpleDiscussion[]>discuss);
        });
    }))
    .thenReturn(discussions);
	}

  /**
   * Return all the meta-discussions for the current user,
   * or those accordingly to the options parameter.
   */
  getAllMetaDiscussions(options?: GetDiscussionsOptions): Bluebird<MetaDiscussion[]> {
    return Bluebird.reject(new Incident("todo", "User:getAllMetaDiscussions is not implemented"));
    // TODO: we need database acces for this one.
  }

  /**
   * Leave the discussion given in parameter, and manage to prevent
   * the current user from receiving future notifications.
   */
  leaveDiscussion(discussion: DiscussionInterface): Bluebird<UserInterface> {
    return Bluebird.try(() => {
      if(discussion instanceof SimpleDiscussion) {
        return this.leaveSimpleDiscussion(<SimpleDiscussion>discussion);
      } else if (discussion instanceof MetaDiscussion) {
        return this.leaveMetaDiscussion(<MetaDiscussion>discussion);
      } else {
        return Bluebird.reject(new Incident("Malformed Discussion", discussion, "This discussion has an unknown type."));
      }
    })
  }

  /**
   * Return all the acccounts of the current user.
   * If protocols is precised, it returns only the accounts
   * matching the protocols given.
   */
  getAccounts(driverNames?: string[]): Bluebird<UserAccountInterface[]> {
    return Bluebird.resolve(this.accounts)
      .filter((account: UserAccountInterface) => {
        if (!driverNames) {
          return Bluebird.resolve(true);
        }
        return account.getGlobalId()
          .then((globalId: palantiri.AccountGlobalId) => {
            let ref = palantiri.Id.parseGlobal(globalId);
            return ref !== null && driverNames.indexOf(ref.driverName) >= 0;
          });
      });
  }

  /**
   * Add an account to the current user.
   * If the account already exists, the return promise will be rejected.
   */
  addAccount(account: UserAccountInterface): Bluebird<User> {
    let ids: palantiri.AccountGlobalId[] = [];
    return Bluebird
      .resolve(this.getAccountsIDs())
      .then((accountIDs: palantiri.AccountGlobalId[]) => {
        ids = accountIDs;
        return account.getGlobalId();
      })
      .then((id: palantiri.AccountGlobalId) => {
        if(ids.indexOf(id) === -1) {
          this.accounts.push(account);
        } else {
          return Bluebird.reject(new Incident("Already existing account", account, "This account is already known by the current user."));
        }
      })
      .thenReturn(this);
  }

  /**
   * Remove an account to the current user.
   * If the account does not already exist, the return promise will be rejected.
   */
  removeAccount(account: UserAccountInterface): Bluebird<this> {
    let ids: palantiri.AccountGlobalId[] = [];
    return Bluebird
      .resolve(this.getAccountsIDs())
      .then((accountIDs: palantiri.AccountGlobalId[]) => {
        ids = accountIDs;
        return account.getGlobalId();
      })
      .then((id: palantiri.AccountGlobalId) => {
        if(ids.indexOf(id) === -1) {
          return Bluebird.reject(new Incident("Unknown account", account, "This account is unknown by the current user."));
        } else {
          this.accounts.splice(ids.indexOf(id), 1);
        }
      })
      .thenReturn(this);
  }

  /* Protected methods */
	/**
   * Leave a simple-discussion.
   */
  protected leaveSimpleDiscussion(discussion: SimpleDiscussion): Bluebird.Thenable<User> {
    let discussAccount : UserAccountInterface = null;
    let discussAccountID : palantiri.AccountGlobalId = null;
    return Bluebird
      .resolve(discussion.getLocalUserAccount())
      .then((account: UserAccountInterface) => {
        discussAccount = account;
        return discussAccount.getGlobalId();
      })
      .then((id: palantiri.AccountGlobalId) => {
        discussAccountID = id;
        return this.getAccountsIDs();
      })
      .then((ids: palantiri.AccountGlobalId[]) => {
        if(ids.indexOf(discussAccountID) !== -1) {
          return discussAccount.getOrCreateApi()
            .then((api: palantiri.Api) => {
              return api.leaveDiscussion(discussAccountID);
            });
        } else {
          return Bluebird.reject(new Incident("Bad owner", discussion, "The owner of this discussion is not a know account of the current user."));
        }
      })
      .thenReturn(this);
  }

  /**
   * Leave a meta-discussion.
   */
  protected leaveMetaDiscussion(discussion: MetaDiscussion): Bluebird.Thenable<User> {
    // TODO: we will probably need to erase the meta discussion from the database.
    return Bluebird
      .resolve(discussion.getSubDiscussions())
      .then((discuss: SimpleDiscussion[]) => {
        return Bluebird
          .all(_.map(discuss, (subdiscuss: SimpleDiscussion) => {
            return this.leaveSimpleDiscussion(subdiscuss);
          }));
      })
      .thenReturn(this);
  }

	/**
   * Return all the global IDs of the accounts of the current user.
   */
  protected getAccountsIDs(): Bluebird.Thenable<palantiri.AccountGlobalId[]> {
    return Bluebird
      .resolve(this.getAccounts())
      .then((accounts: UserAccountInterface[]) => {
        return Bluebird
          .all(_.map(accounts, (account: UserAccountInterface) => {
            return account.getGlobalId();
          }));
      });
  }
}

export default User;
