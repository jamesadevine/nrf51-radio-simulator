import {Link, LinkClient, LinkPacket, PacketType, LINK_PORT} from "./Link";
import {PeridoRadio} from "./PeridoRadio";


class Action
{
    action:string;
    newState:string;
    time: Number;

    constructor(action:string, newState:string, time:Number = 0)
    {
        this.action = action;
        this.newState = newState;
        this.time = time;
    }
}

class State
{
    name:string;
    previousActions:Action[]
    nextActions:Action[]
    triggerAction:Action

    constructor(name:string, previousActions:Action[],nextActions:Action[],triggerAction:Action)
    {
        this.name = name;
        this.previousActions = previousActions;
        this.nextActions = nextActions;
        this.triggerAction = triggerAction;
    }

    validateAction(action: Action)
    {
        for(let a of this.nextActions)
        {
            if(a.action == action.action)
            {
                return true;
            }
        }

        return false;
    }
}

let rxEnable: Action = new Action("RX_EN","RXRU");
let rxDisable: Action = new Action("DISABLE","RXDISABLE");
let rxReady: Action = new Action("READY", "RXIDLE", 135);
let rxStart: Action = new Action("START", "RX");
let rxEnd: Action = new Action("END", "RXIDLE");
let rxStop: Action = new Action("STOP", "RXIDLE");
let rxAddress: Action = new Action("ADDRESS", "RX");
let rxPayload: Action = new Action("PAYLOAD", "RX");


let txEnable: Action = new Action("TX_EN","TXRU");
let txDisable: Action = new Action("DISABLE","TXDISABLE");
let txReady: Action = new Action("READY", "TXIDLE", 135);
let txStart: Action = new Action("START", "TX");
let txEnd: Action = new Action("END", "TXIDLE", 166);
let txStop: Action = new Action("STOP", "TXIDLE");
let txAddress: Action = new Action("ADDRESS", "TX", 40);
let txPayload: Action = new Action("PAYLOAD", "TX");

let disableAction: Action = new Action("DISABLE", "DISABLED", 30);

let noneAction: Action = new Action("NONE", "NONE");
let noneState: State = new State("NONE",[],[],noneAction);

// {
//     "name":"DISABLED",
//     "previous_actions":["DISABLED"],
//     "next_actions":[{ "action": "TX_EN", "new_state":"TXRU"},{ "action": "RX_EN", "new_state":"RXRU"}]
// }
let disabledState = new State("DISABLED",[txDisable,rxDisable],[txEnable,rxEnable],noneAction);
// {
//     "name":"RXRU",
//     "previous_actions":["RX_EN"],
//     "next_actions":[{ "action": "DISABLE", "new_state":"RXDISABLE"}, { "action": "READY", "new_state":"RXIDLE"}],
//     "trigger_action":[{"action":"READY", "time":10}]
// },
let rxruState = new State("RXRU",[rxEnable],[rxDisable,rxReady],rxReady);

// {
//     "name":"RXIDLE",
//     "previous_actions":["READY", "RX_END", "RX_STOP"],
//     "next_actions":[ { "action": "DISABLE", "new_state":"RXDISABLE"}, {"action":"START", "new_state":"RX"}]
// },
let rxIdleState = new State("RXIDLE",[rxReady,rxEnd,rxStop],[rxDisable,rxStart], noneAction);

// {
//     "name":"RX",
//     "previous_actions":["RX_START", "RX_ADDRESS", "RX_PAYLOAD"],
//     "next_actions":[{ "action": "DISABLE", "new_state":"RXDISABLE"},{ "action": "END", "new_state":"RXIDLE"},{ "action": "STOP", "new_state":"RXIDLE"},{ "action": "ADDRESS", "new_state":"RX"},{ "action": "PAYLOAD", "new_state":"RX"}]
// },
let rxState = new State("RX",[rxStart,rxAddress,rxPayload],[rxDisable,rxEnd,rxStop,rxAddress,rxPayload], noneAction);

// {
//     "name":"RXDISABLE",
//     "previous_actions":["DISABLE"],
//     "next_actions":[{ "action": "DISABLED", "new_state":"DISABLED"}]
// },
let rxDisableState = new State("RXDISABLE",[rxDisable],[disableAction], disableAction);

// {
//     "name":"TXRU",
//     "previous_actions":["TX_EN"],
//     "next_actions":[{ "action": "DISABLE", "new_state":"TXDISABLE"},{ "action": "READY", "new_state":"TXIDLE"}],
//     "trigger_action":[{"action":"READY", "time":10}]
// },
let txruState = new State("TXRU",[txEnable],[txDisable,txReady], txReady);

// {
//     "name":"TXIDLE",
//     "previous_actions":["READY","END","STOP"],
//     "next_actions":[{ "action": "DISABLE", "new_state":"TXDISABLE"}, {"action":"START", "new_state":"TX"}]
// },
let txIdleState = new State("TXIDLE",[txReady,txEnd,txStop],[txDisable,txStart], noneAction);

// {
//     "name":"TX",
//     "previous_actions":["TX_START", "TX_ADDRESS", "TX_PAYLOAD"],
//     "next_actions":[{ "action": "DISABLE", "new_state":"TXDISABLE"},{ "action": "END", "new_state":"TXIDLE"},{ "action": "STOP", "new_state":"TXIDLE"},{ "action": "ADDRESS", "new_state":"TX"}, { "action": "PAYLOAD", "new_state":"TX"}]
// },
let txState = new State("TX",[txStart,txAddress,txPayload],[txDisable,txEnd,txStop,txAddress,txPayload], noneAction);

// {
//     "name":"TXDISABLE",
//     "previous_actions":["DISABLE"],
//     "next_actions":[{ "action": "DISABLED", "new_state":"DISABLED"}]
// }
let txDisableState = new State("TXDISABLE",[txDisable],[disableAction], disableAction);

let radio_states:State[] = [
    disabledState,
    rxruState,
    rxIdleState,
    rxState,
    rxDisableState,
    txruState,
    txIdleState,
    txState,
    txDisableState
]

class StateMachine
{
    states:State[];
    currentState:State

    constructor(states:State[])
    {
        this.states = states;
        this.currentState = disabledState;
    }

    stateExists(stateName:string): boolean
    {
        for (let s of this.states)
        {
            if (s.name == stateName)
                return true;
        }

        return false;
    }

    stateFromName(stateName:string): State
    {
        for (let s of this.states)
        {
            if (s.name == stateName)
                return s;
        }

        return noneState;
    }

    commenceAction(action:Action)
    {
        let validAction = this.currentState.validateAction(action);
        let validState = this.stateExists(action.newState);

        if (validAction && validState)
            this.currentState = this.stateFromName(action.newState);
        else
            throw new Error("Invalid state transition from: "+ this.currentState.name + " to: " + action.newState);
    }
}

class Interrupt
{
    name:string;
    state: Number;
    enabled:boolean;
    cb:(event: string) => void;

    constructor(name:string, enabled: boolean, callback:(event: string) => void)
    {
        this.name = name;
        this.enabled = enabled;
        this.cb = callback;
        this.state = 0;
    }
}

class InterruptManager
{
    interrupts:Interrupt[];

    constructor()
    {
        this.interrupts = [new Interrupt("END",false,null), new Interrupt("READY",false,null), new Interrupt("ADDRESS",false,null)]
    }

    enable(name: string, cb: (event: string) => void)
    {
        for (let i of this.interrupts)
            if(i.name == name)
            {
                i.enabled = true;
                i.cb = cb;
            }
    }

    set(name: string, value: Number)
    {
        for (let i of this.interrupts)
            if(i.name == name)
                i.state = value;
    }

    interrupt(name: string)
    {
        for (let i of this.interrupts)
        {
            if (i.name == name)
            {
                i.state = 1;

                if(i.enabled)
                    i.cb(name);
            }
        }
    }

    getInterrupt(name: string): Number
    {
        for (let i of this.interrupts)
            if(i.name == name)
                return i.state;

        return -1;
    }

}

class Radio
{
    stateMachine: StateMachine;
    interruptManager: InterruptManager = new InterruptManager();

    timeouts: number[];

    lc: LinkClient;

    rxPackets: any[];

    packet: any;
    crcstatus: number;

    constructor()
    {
        this.lc = new LinkClient(LINK_PORT);
        this.stateMachine = new StateMachine(radio_states);
        this.timeouts = [];
        this.rxPackets = [];

        this.crcstatus = 1;

        this.lc.setRxCallback(this.recv_from_pipe);
    }

    schedule_state_update(a:Action,cb?:()=>void)
    {
        let id = setTimeout(this.update_state, a.time, a, cb);
        this.timeouts.push(id);
    }

    schedule_interrupt(event:string)
    {
        var valid = false;

        for (let i of this.interruptManager.interrupts)
            if (i.name == event)
                valid = true;

        if (!valid)
            return;

        let t:Number = 0;
        let id = setTimeout(this.deferred_event, t, event);
        this.timeouts.push(id);
    }

    deferred_event = (event: string,test:number) =>
    {
        this.interruptManager.interrupt(event);
    }

    update_state = (action:Action,cb?:()=>void) =>
    {
        if (cb)
            cb();

        console.log('old state: ',this.stateMachine.currentState.name);
        this.stateMachine.commenceAction(action);
        console.log('new state: ',this.stateMachine.currentState.name,"\r\n");

        if (this.stateMachine.currentState.triggerAction.action != "NONE")
            // schedule callback
            this.schedule_state_update(this.stateMachine.currentState.triggerAction);

        this.schedule_interrupt(action.action);
    }

    enable_interrupt(name: string, cb: (event: string) => void)
    {
        this.interruptManager.enable(name,cb);
    }

    get_state(): State
    {
        return this.stateMachine.currentState;
    }

    recv_from_pipe = (packet: any, type: PacketType) =>
    {
        if(type == PacketType.StandardPacket)
        {
            if (this.stateMachine.currentState.name == "RX")
            {
                PeridoRadio.instance.rxBuf = packet;
                // this.packet = packet;
                this.update_state(rxEnd);
            }
            else
            {
                console.log("NOT IN RX");
            }
        }

        if(type == PacketType.LinkPacket)
        {
            if(packet.action == "ADDRESS" && (this.stateMachine.currentState.name == "RX"))
            {
                this.schedule_interrupt(packet.action);
            }
        }
    }

    CRCSTATUS()
    {
        return this.crcstatus;
    }

    PACKETPTR(data:any = null)
    {
        if (data == null)
            return this.packet

        this.packet = data;
    }

    EVENTS_END(value:Number = -1)
    {
        if (value == -1)
            return this.interruptManager.getInterrupt("END");

        this.interruptManager.set("END", value);
    }

    EVENTS_ADDRESS(value:Number = -1)
    {
        if (value == -1)
            return this.interruptManager.getInterrupt("ADDRESS");

        this.interruptManager.set("ADDRESS", value);
    }

    EVENTS_READY(value:Number = -1)
    {
        if (value == -1)
            return this.interruptManager.getInterrupt("READY");

        this.interruptManager.set("READY", value);
    }

    EVENTS_DISABLED(value:Number = -1)
    {
        if (value == -1)
            return this.interruptManager.getInterrupt("DISABLE");

        this.interruptManager.set("DISABLE", value);
    }


    TASKS_TXEN(value:Number)
    {
        if (value > 0)
            this.update_state(txEnable);
    }


    TASKS_RXEN(value:Number)
    {
        if (value > 0)
            this.update_state(rxEnable)
    }

    TASKS_DISABLE(value:Number)
    {
        if (value > 0)
        {
            for(let id of this.timeouts)
                clearTimeout(id);

            this.timeouts = [];

            if (this.stateMachine.currentState.name.indexOf("TX") > -1)
            {
                console.log("CLEARING TX")
                this.update_state(txDisable)
            }
            else if (this.stateMachine.currentState.name.indexOf("RX") > -1)
            {
                console.log("CLEARING RX")
                this.update_state(rxDisable)
            }
        }
    }


    TASKS_START(value:Number)
    {
        if (value > 0)
        {
            if (this.stateMachine.currentState.name.indexOf("TX") > -1)
            {
                if (this.stateMachine.currentState.name != "TXIDLE")
                {
                    throw new Error("Invalid tasks start state, current state: " + this.stateMachine.currentState.name);
                }
                this.update_state(txStart)

                this.schedule_state_update(txAddress,()=>{
                    this.lc.send({"action":"ADDRESS"}, PacketType.LinkPacket);
                })

                this.schedule_state_update(txEnd,()=>{
                    this.lc.send(this.packet);
                })
            }
            else if(this.stateMachine.currentState.name.indexOf("RX") > -1)
            {
                if (this.stateMachine.currentState.name != "RXIDLE")
                {
                    throw new Error("Invalid tasks start state, current state: " + this.stateMachine.currentState.name);
                }

                this.update_state(rxStart)
            }

        }
    }
}

export {Radio};

