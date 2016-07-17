/* This class implements the Hayes command set as described in:
 *
 *   https://en.wikipedia.org/wiki/Hayes_command_set
 */
class Modem {

	constructor(replyCallback, dialCallback, transmitCallback, answerCallback) {
		this.escapeCount      = 0;
		this.timer            = null;
		this.echo             = true;
		this.verbose          = true;
		this.selectedRegister = 0;
		this.cmdBuffer        = "";
		this.lastCommande     = "";
		this.commandMode      = true;
		
		this.registerValues   = [
			0,  // S0 - Number of rings before auto answer
			0,  // S1 - Ring counter
			43, // S2 - Escape character
			13, // S3 - Carriage return
			10, // S4 - Line feed
			8,  // S5 - Backspace
			2,  // S6 - Wait time before blind dialing
			50, // S7 - Wait for carrier after dial
			2,  // S8 - Pause time for Comma
			6,  // S9 - Carrier Detect Response Time
			14, // S10 - Delay between loss of carrier and hang-up
			95, // S11 - DTMF Tone Duration
			50  // S12 - Escape code guard time (in fiftieths of seconds)
		];
		
		this.dialCallback      = dialCallback;
		this.replyCallback     = replyCallback;
		this.transmitCallback  = transmitCallback;
		this.answerCallback    = answerCallback;
	}
	
	get guardTime() {
		return this.registerValues[12]*20; // In miliseconds
	}
	
	get cr() {
		return String.fromCharCode(this.registerValues[3]);
	}
	
	get lf() {
		return String.fromCharCode(this.registerValues[4]);
	}
	
	get bs() {
		return String.fromCharCode(this.registerValues[5]);
	}

	get autoAnswer() {
		return this.registerValues[0];
	}
	
	get ringCounter() {
		return this.registerValues[1];
	}
	
	set ringCounter(value) {
		this.registerValues[1] = value;
	}
	
	_print(str) {
		this.replyCallback(str);
	}

	ring() {
		this.ringCounter++;
		if(this.autoAnswer != 0 && this.ringCounter == this.autoAnswer) {
			this.answer();
		} else {
			this.cmdResultCode(2, "RING");
			this.sendLastCmdResult();
		}
	}
	
	dataFromRemote(data) {
		if(!this.commandMode) {
			this._print(data);
		}
	}

	connectionEstablished() {
		this.cmdResultCode(1, "CONNECT");
		this.sendLastCmdResult();
		this.dataMode();
	}
	
	answer() {
		console.log("Answering");
		this.connectionEstablished();
		this.answerCallback();
	}
	
	commandMode() {
		this.cmdOk();
		this.commandMode = true;
	}
	
	dataMode() {
		this.escapeCount  = 0;
		this.lastCharTime = Date.now();
		this.commandMode  = false;
	}

	/* Extracts the value of a short command, such as E0 */
	getCmdValue(matchSet) {
		return matchSet[1] ? parseInt(matchSet[1],10) : 0;
	}
	
	/* Processes a short command, such as E0 that has no side effects other than setting a
	 * property to a numeric value */
	valueCmd(matchSet, prop, noOk) {
		this[prop] = this.getCmdValue(matchSet);
		this.cmdOk();
	}
	
	/* These commands have side-effects, but inherit from valueCmd */
	hookCmd(matchSet, prop) {
		var onhook = this.getCmdValue(matchSet);
		this.cmdOk();
	}

	infoCmd(matchSet, prop) {
		switch(this.getCmdValue(matchSet)) {
			case 0:
				this.cmdInfoText("RetroWeb Smartmodem");
				break;
			default:
				this.cmdError();
				break;
		}
	}

	cmdInfoText(text) {
		this.cmdResult = {text: "OK", isInfo: true};
	}

	cmdResultCode(code, text) {
		this.cmdResult = {code: code, text: text};
	}

	cmdOk() {
		this.cmdResultCode(0, "OK");
	}

	cmdError() {
		this.cmdResultCode(4, "ERROR");
	}
	
	sendLastCmdResult() {
		if(this.cmdResult) {
			if(this.verbose) {
				this._print(this.cr + this.lf + this.cmdResult.text + this.cr + this.lf);
			} else {
				if(this.cmdResult.isInfo) {
					this._print(this.cmdResult.text + this.cr + this.lf);
				} else {
					this._print(this.cmdResult.code + this.cr);
				}
			}
			console.log("Modem reply: ", this.cmdResult.text);
		}
	}

	/* These commands are specialized */
	dialCmd(matchSet) {
		var dialStr = matchSet[2];
		this.dialCallback(dialStr);
	}

	onlineCmd(matchSet) {
		console.log("Going online");
		this.dataMode();
	}
	
	answerCmd(matchSet) {
		this.answer();
	}

	resetCmd(matchSet) {
		console.log("Resetting modem");
		this.cmdOk();
	}

	registerCmd(matchSet) {
		var register  = matchSet[1];
		var operation = matchSet[2] ? matchSet[2][0] : null;
		var value     = matchSet[3];
		if(register) {
			this.selectedRegister = register;
		}
		switch(operation) {
			case '?':
				this.cmdInfoText(this.registerValues[this.selectedRegister]);
				break;
			case '=':
				this.registerValues[this.selectedRegister] = value;
				console.log("Setting register", this.selectedRegister, "to", value);
				break;
		}
		this.cmdOk();
	}

	processCommand(command) {
		this.cmdResult = null;
		this.lastCommand = command;
		console.log("Modem command:", command);

		var me = this;
		function error() {
			me.cmdError();
			command = "";
		}
		
		function execActionIfCmdMatches(regex, action, arg) {
			var match = false;
			command = command.replace(regex,
				function() {
					if(action) {
						action.call(me, arguments, arg);
					}
					match = true;
					return ''; // Eat the match
				}
			);
			return match;
		}

		execActionIfCmdMatches(/^AT/i) ||
		error();

		while(command.length) {
			execActionIfCmdMatches(/^A/i,                         this.answerCmd             ) ||
			execActionIfCmdMatches(/^D([TP])([0-9WR@,;!L]+)/i,    this.dialCmd               ) ||
			execActionIfCmdMatches(/^E([01])?/i,                  this.valueCmd, "echo"      ) ||
			execActionIfCmdMatches(/^H([01])?/i,                  this.hookCmd,  "hook"      ) ||
			execActionIfCmdMatches(/^I([0-9])?/i,                 this.infoCmd,  "queryInfo" ) ||
			execActionIfCmdMatches(/^L([0-3])?/i,                 this.valueCmd, "loudness"  ) ||
			execActionIfCmdMatches(/^M([0-3])?/i,                 this.valueCmd, "speaker"   ) ||
			execActionIfCmdMatches(/^O/i,                         this.onlineCmd             ) ||
			execActionIfCmdMatches(/^Q([0-1])?/i,                 this.valueCmd, "quiet"     ) ||
			execActionIfCmdMatches(/^V([0-1])?/i,                 this.valueCmd, "verbose"   ) ||
			execActionIfCmdMatches(/^X([0-1])?/i,                 this.valueCmd, "smart"     ) ||
			execActionIfCmdMatches(/^Z0?/i,                       this.resetCmd              ) ||
			execActionIfCmdMatches(/^S([0-9]*)(\?|\=([0-9]+))?/i, this.registerCmd           ) ||
			execActionIfCmdMatches(/^F[0-9]/i,                    this.resetCmd              ) || // Non-standard?
			error();
		}

		this.sendLastCmdResult();
	}

	processCharacter(c) {
		if(this.commandMode) {
			if(this.echo) {
				this._print(c);
			}
			switch(c) {
				case this.cr:
					this.processCommand(this.cmdBuffer);
					this.cmdBuffer = "";
					break;
				case this.bs:
					if(this.cmdBuffer.length) {
						this.cmdBuffer = this.cmdBuffer.substr(0, this.cmdBuffer.length-1);
					}
					break;
				case ' ':
					//Skip whitespace
					break;
				default:
					this.cmdBuffer += c;
					if(this.cmdBuffer == "A/" || this.cmdBuffer == "a/") {
						this.processCommand(this.lastCommand);
						this.cmdBuffer = "";
					}
					break;
			}
		} else {
			// Data mode
			this.transmitCallback(c);
			if(c == '+' && (Date.now() - this.lastCharTime) > this.guardTime) {
				this.escapeCount++;
				if(this.escapeCount == 3) {
					this.timer = window.setTimeout(commandMode, this.guardTime);
				}
			} else {
				if(this.timer) {
					window.clearTimeout(this.guardTimer);
					this.timer = null;
				}
				this.escapeCount  = 0;
				this.lastCharTime = Date.now();
			}
		}
	}
}