import {Radio} from "./Radio"

const LOW_LEVEL_STATE_MASK = 0x0000FFFF      // a mask for removing or retaining low level state

const RADIO_STATUS_RX_EN = 0x00000001      // reception is enabled
const RADIO_STATUS_RX_RDY = 0x00000002      // available to receive packets

const RADIO_STATUS_TX_EN = 0x00000008      // transmission is enabled
const RADIO_STATUS_TX_RDY = 0x00000010      // transmission is ready
const RADIO_STATUS_TX_ST = 0x00000020      // transmission has begun
const RADIO_STATUS_TX_END = 0x00000040      // transmission has finished

const RADIO_STATUS_DISABLE = 0x00000080      // the radio should be disabled
const RADIO_STATUS_DISABLED = 0x00000100      // the radio is disabled

// high level actions
const HIGH_LEVEL_STATE_MASK = 0xFFFF0000      // a mask for removing or retaining high level state

const RADIO_STATUS_TRANSMIT = 0x00020000      // moving into transmit mode to send a packet.
const RADIO_STATUS_FORWARD = 0x00040000      // actively forwarding any received packets
const RADIO_STATUS_RECEIVING = 0x00080000      // in the act of currently receiving a packet.
const RADIO_STATUS_STORE = 0x00100000      // indicates the storage of the rx'd packet is required.
const RADIO_STATUS_DISCOVERING = 0x00200000      // listening for packets after powering on, prevents sleeping in rx mode.
const RADIO_STATUS_SLEEPING = 0x00400000      // indicates that the window of transmission has passed, and we have entered sleep mode.
const RADIO_STATUS_WAKE_CONFIGURED = 0x00800000

const LAST_SEEN_BUFFER_SIZE = 3

let radio_status_array: any[] = [
    {"bitmsk": RADIO_STATUS_RX_EN,"text":"RX_EN"},
    {"bitmsk": RADIO_STATUS_RX_RDY,"text":"RX_RDY"},
    {"bitmsk": RADIO_STATUS_TX_EN,"text":"TX_EN"},
    {"bitmsk": RADIO_STATUS_TX_RDY,"text":"TX_RDY"},
    {"bitmsk": RADIO_STATUS_TX_ST,"text":"TX_ST"},
    {"bitmsk": RADIO_STATUS_TX_END,"text":"TX_END"},
    {"bitmsk": RADIO_STATUS_DISABLE,"text":"DISABLE"},
    {"bitmsk": RADIO_STATUS_DISABLED,"text":"DISABLED"},
    {"bitmsk": RADIO_STATUS_TRANSMIT,"text":"TRANSMIT"},
    {"bitmsk": RADIO_STATUS_FORWARD,"text":"FORWARDING"},
    {"bitmsk": RADIO_STATUS_RECEIVING,"text":"RECEIVING"},
    {"bitmsk": RADIO_STATUS_STORE,"text":"STORING"},
    {"bitmsk": RADIO_STATUS_DISCOVERING,"text":"DISCOVERING"},
    {"bitmsk": RADIO_STATUS_SLEEPING,"text":"SLEEPING"},
    {"bitmsk": RADIO_STATUS_WAKE_CONFIGURED,"text":"WAKE IS CONFIGURED"},
]

/**
 *  Timings for each event (us):
 *
 *  TX Enable               135
 *  TX (15 bytes)           166
 *  DISABLE                 10
 *  RX Enable               135
 **/

const DISCOVERY_TX_BACKOFF_TIME  = 10000
const DISCOVERY_BACKOFF_TIME = (DISCOVERY_TX_BACKOFF_TIME * 2)

const SLEEP_BACKOFF_TIME = 5000
const TX_BACKOFF_MIN = 100
const TX_BACKOFF_TIME = (1000 - TX_BACKOFF_MIN)
const TX_TIME = 300         // includes tx time for a larger packet
const TX_ENABLE_TIME = 300         // includes processing time overhead on reception for other nodes...
const RX_ENABLE_TIME = 200
const RX_TX_DISABLE_TIME = 35          // 10 us is pretty pointless for a timer callback.

const WAKE_UP_CHANNEL = 0
const GO_TO_SLEEP_CHANNEL = 1
const CHECK_TX_CHANNEL = 2
const STATE_MACHINE_CHANNEL = 3

var radio_status: number = 0;
var previous_period: number = 0;

var packet_received_count: number = 0;
var sleep_received_count: number = 0;
var tx_received_count: number = 0;

var last_seen_index = 0;
var last_seen:any[] = [0,0,0];

function microbit_random(num:number)
{
    return Math.floor(Math.random() * num);
}

class PeridoFrameBuffer
{
    length: number;                             // The length of the remaining bytes in the packet.
    ttl: number;
    id: number;
    app_id: number;
    namespace_id: number;
    sleep_period_ms: number;
    payload: string;    // User / higher layer protocol data
}

class PeridoTimer
{
    count: number;
    cb: (channel_num:number) => void

    constructor()
    {
        this.cb = null;
        setInterval(this.incrementCount, 1);
    }

    setFunction(cb: (channel_num:number) => void)
    {
        this.cb = cb;
    }

    setCompare(channel: number, sleepPeriod: number)
    {
        setTimeout(this.cb, sleepPeriod, channel);
    }

    captureCounter(number: number)
    captureCounter()
    {
        return 0;
        //return this.count;
    }

    incrementCount = () =>
    {
        this.count++;
    }
}

function debug_radio_state()
{
    var low_level = []
    var high_level = []

    for (let rs of radio_status_array)
    {
        if(rs.bitmsk & LOW_LEVEL_STATE_MASK && radio_status & rs.bitmsk)
            low_level.push(rs.text);

        if(rs.bitmsk & HIGH_LEVEL_STATE_MASK && radio_status & rs.bitmsk)
            high_level.push(rs.text);
    }

    console.log("-----------------------");
    console.log("Radio has these low-level states enabled: \r\n",low_level.join(", "))
    console.log("\r\n");
    console.log("Radio has these high-level states enabled: \r\n",high_level.join(", "))
    console.log("\r\n");
    console.log("Low-level Radio has this state enabled: \r\n",PeridoRadio.instance.radio.stateMachine.currentState.name);
    console.log("\r\n");
    console.log("Radio Q Depth: \r\n",PeridoRadio.instance.txQueue.length);
    console.log("-----------------------");
}

function radio_state_machine()
{
    debug_radio_state();

    if(radio_status & RADIO_STATUS_DISABLED)
    {
        PeridoRadio.instance.radio.EVENTS_DISABLED(0);
        PeridoRadio.instance.radio.EVENTS_END(0);

        if(radio_status & RADIO_STATUS_TX_EN)
        {
            console.log("TX EN")
            radio_status &= ~(RADIO_STATUS_TX_EN | RADIO_STATUS_DISABLED);
            radio_status |= RADIO_STATUS_TX_RDY;

            PeridoRadio.instance.radio.EVENTS_READY(0);
            PeridoRadio.instance.radio.TASKS_TXEN(1);
            PeridoRadio.instance.timer.setCompare(STATE_MACHINE_CHANNEL, PeridoRadio.instance.timer.captureCounter(STATE_MACHINE_CHANNEL) + TX_ENABLE_TIME);
            return;
        }

        if(radio_status & RADIO_STATUS_RX_EN)
        {
            console.log("RX EN")
            PeridoRadio.instance.radio.PACKETPTR(PeridoRadio.instance.rxBuf);

            radio_status &= ~(RADIO_STATUS_RX_EN | RADIO_STATUS_DISABLED);
            radio_status |= RADIO_STATUS_RX_RDY;

            // takes 7 us to complete, not much point in a timer.
            PeridoRadio.instance.radio.EVENTS_READY(0);
            PeridoRadio.instance.radio.TASKS_RXEN(1);
            PeridoRadio.instance.timer.setCompare(STATE_MACHINE_CHANNEL, PeridoRadio.instance.timer.captureCounter(STATE_MACHINE_CHANNEL) + RX_ENABLE_TIME);
            return;
        }
    }
    if(radio_status & RADIO_STATUS_RX_RDY)
    {
        if (PeridoRadio.instance.radio.EVENTS_READY())
        {
            console.log("RX RDY")
            PeridoRadio.instance.radio.EVENTS_READY(0);
            PeridoRadio.instance.radio.TASKS_START(1);
            return;
        }

        // we get an address event for rx, indicating we are in the process of receiving a packet. Update our status and return;
        if(PeridoRadio.instance.radio.EVENTS_ADDRESS())
        {
            console.log("RX ADDR")
            PeridoRadio.instance.radio.EVENTS_ADDRESS();
            radio_status |= RADIO_STATUS_RECEIVING;
            return;
        }

        if(PeridoRadio.instance.radio.EVENTS_END())
        {

            console.log("RX END");
            radio_status &= ~(RADIO_STATUS_RECEIVING);

            packet_received_count++;

            PeridoRadio.instance.radio.EVENTS_END(0);
            PeridoRadio.instance.radio.TASKS_START(1);

            if(PeridoRadio.instance.radio.CRCSTATUS() == 1)
            {
                let p: PeridoFrameBuffer = PeridoRadio.instance.rxBuf;
                console.log(p);
                if (p)
                {
                    if(p.ttl > 0)
                    {
                        p.ttl--;
                        radio_status &= ~RADIO_STATUS_RX_RDY;
                        radio_status |= (RADIO_STATUS_FORWARD | RADIO_STATUS_DISABLE | RADIO_STATUS_TX_EN);
                    }
                    else
                    {
                        radio_status |= RADIO_STATUS_STORE;
                    }
                }
            }
            else
            {
                // add last packet to worry queue
            }

            // we have officially finished discovery, and are aligned with the current schedule. Begin determining the end of transmission.
            if (radio_status & RADIO_STATUS_DISCOVERING)
            {
                console.log("DISCOVER")
                radio_status &= ~RADIO_STATUS_DISCOVERING;
                PeridoRadio.instance.timer.setCompare(GO_TO_SLEEP_CHANNEL, PeridoRadio.instance.timer.captureCounter(GO_TO_SLEEP_CHANNEL) + SLEEP_BACKOFF_TIME);
            }
        }
    }

    if(radio_status & RADIO_STATUS_TRANSMIT)
    {
        // we get an address event for tx, clear and get out!
        if(PeridoRadio.instance.radio.EVENTS_ADDRESS())
        {
            console.log("TX ADDR")
            PeridoRadio.instance.radio.EVENTS_ADDRESS(0);
            return;
        }

        if(radio_status & RADIO_STATUS_TX_RDY)
        {
            console.log("TX RDY")
            let p: PeridoFrameBuffer = PeridoRadio.instance.txQueue[0] || null;

            radio_status &= ~RADIO_STATUS_TX_RDY;
            radio_status |= RADIO_STATUS_TX_END;

            if(p != null)
            {
                PeridoRadio.instance.radio.PACKETPTR(p);
                // grab next packet and set pointer
                PeridoRadio.instance.radio.TASKS_START(1);
                PeridoRadio.instance.radio.EVENTS_END(0);

                PeridoRadio.instance.timer.setCompare(STATE_MACHINE_CHANNEL, PeridoRadio.instance.timer.captureCounter(STATE_MACHINE_CHANNEL) + TX_TIME);
                return;
            }
        }

        if(radio_status & RADIO_STATUS_TX_END)
        {
            console.log("TX END")
            radio_status &= ~(RADIO_STATUS_TX_END | RADIO_STATUS_TRANSMIT);

            radio_status |= (RADIO_STATUS_FORWARD | RADIO_STATUS_DISABLE | RADIO_STATUS_RX_EN);

            if(!(radio_status & RADIO_STATUS_DISCOVERING))
                PeridoRadio.instance.timer.setCompare(CHECK_TX_CHANNEL, PeridoRadio.instance.timer.captureCounter(CHECK_TX_CHANNEL) + TX_BACKOFF_MIN + microbit_random(TX_BACKOFF_TIME));

            PeridoRadio.instance.radio.EVENTS_END(0);
        }
    }

    if(radio_status & RADIO_STATUS_FORWARD)
    {
        // we get an address event for tx, clear and get out!
        if(PeridoRadio.instance.radio.EVENTS_ADDRESS())
        {
            console.log("F TX ADDRESS")
            PeridoRadio.instance.radio.EVENTS_ADDRESS(0);
            return;
        }

        if(radio_status & RADIO_STATUS_TX_RDY)
        {
            console.log("F TX RDY")
            radio_status &= ~RADIO_STATUS_TX_RDY;
            radio_status |= RADIO_STATUS_TX_END;

            PeridoRadio.instance.radio.PACKETPTR(PeridoRadio.instance.rxBuf);

            PeridoRadio.instance.radio.TASKS_START(1);
            PeridoRadio.instance.radio.EVENTS_END(0);

            // only the initial sender of the packet will reach a ttl of 0, other nodes will see the last ttl as one
            // we have a little bit of time before the next radio interrupt from a TX complete.
            if (PeridoRadio.instance.rxBuf.ttl == 0)
            {
                radio_status |= RADIO_STATUS_WAKE_CONFIGURED;
                previous_period = PeridoRadio.instance.rxBuf.sleep_period_ms;
                PeridoRadio.instance.timer.setCompare(WAKE_UP_CHANNEL, PeridoRadio.instance.timer.captureCounter(WAKE_UP_CHANNEL) + (previous_period /** 1000*/));
            }

            let tx: PeridoFrameBuffer = PeridoRadio.instance.txQueue[0] || null;

            if(tx != null && PeridoRadio.instance.rxBuf.id == tx.id && PeridoRadio.instance.rxBuf.ttl < tx.ttl)
            {
                console.log("POOOOOOP")
                // only pop our tx buffer if something responds
                PeridoRadio.instance.popTxQueue();
            }

            return;
        }

        if(radio_status & RADIO_STATUS_TX_END)
        {
            console.log("F TX END")
            radio_status &= ~RADIO_STATUS_TX_END;
            radio_status |= RADIO_STATUS_DISABLE | RADIO_STATUS_RX_EN;

            // the original sender won't reach a ttl of 1, account for the transmitter configuring timer using an offset of a cycle to TX mode
            if(PeridoRadio.instance.rxBuf.ttl == 1)
            {
                console.log("WAKE CONFIGURED");

                radio_status &= ~RADIO_STATUS_FORWARD;
                radio_status |= RADIO_STATUS_WAKE_CONFIGURED;
                previous_period = PeridoRadio.instance.rxBuf.sleep_period_ms;
                PeridoRadio.instance.timer.setCompare(WAKE_UP_CHANNEL, PeridoRadio.instance.timer.captureCounter(WAKE_UP_CHANNEL) + (previous_period /** 1000*/) + TX_ENABLE_TIME + RX_TX_DISABLE_TIME);
            }

            PeridoRadio.instance.radio.EVENTS_END(0);
        }

    }

    if(radio_status & RADIO_STATUS_STORE)
    {
        console.log("store")
        radio_status &= ~RADIO_STATUS_STORE;

        let p: PeridoFrameBuffer = PeridoRadio.instance.rxBuf;


        // set the next wake up time accounting for the time it takes for the sender to receive, and flag for storage
        if (p.ttl == 1)
        {
            radio_status |= RADIO_STATUS_WAKE_CONFIGURED;
            PeridoRadio.instance.timer.setCompare(WAKE_UP_CHANNEL, PeridoRadio.instance.timer.captureCounter(WAKE_UP_CHANNEL) + (p.sleep_period_ms/* * 1000*/) + TX_ENABLE_TIME);
            previous_period = p.sleep_period_ms;
        }

        let seen = false;

        // check if we've seen this ID before...
        for (var i = 0; i < LAST_SEEN_BUFFER_SIZE; i++)
            if(last_seen[i] == p.id)
            {
                // log_string("seen\r\n");
                seen = true;
            }

        // if seen, queue a new buffer, and mark it as seen
        if(!seen)
        {
            PeridoRadio.instance.queueRxBuf();
            PeridoRadio.instance.radio.PACKETPTR(PeridoRadio.instance.rxBuf);

            console.log("perido received")
            // valid_packet_received(PeridoRadio.instance.recv());

            last_seen[last_seen_index] = p.id;
            last_seen_index = (last_seen_index + 1) %  LAST_SEEN_BUFFER_SIZE;
        }
    }

    if(radio_status & RADIO_STATUS_DISABLE)
    {
        console.log("disable")
        // Turn off the transceiver.
        PeridoRadio.instance.radio.EVENTS_DISABLED(0);
        PeridoRadio.instance.radio.TASKS_DISABLE(1);
        radio_status &= ~RADIO_STATUS_DISABLE;
        radio_status |= RADIO_STATUS_DISABLED;

        PeridoRadio.instance.timer.setCompare(STATE_MACHINE_CHANNEL, PeridoRadio.instance.timer.captureCounter(STATE_MACHINE_CHANNEL) + RX_TX_DISABLE_TIME);
        return;
    }
}

function radio_IRQ(event:string)
{
    console.log("IRQ");
    radio_state_machine();
}

function tx_callback()
{
    console.log("tx callback");
    // nothing to do if sleeping
    if(radio_status & RADIO_STATUS_SLEEPING)
        return;

    // no one else has transmitted recently, and we are not receiving, we can transmit
    if(packet_received_count == tx_received_count && PeridoRadio.instance.txQueue.length > 0 && !(radio_status & (RADIO_STATUS_RECEIVING | RADIO_STATUS_FORWARD)))
    {
        console.log("tx cb TX");
        radio_status = (radio_status & RADIO_STATUS_DISCOVERING) | RADIO_STATUS_TRANSMIT | RADIO_STATUS_DISABLE | RADIO_STATUS_TX_EN;
        radio_state_machine();
        return;
    }

    // otherwise randomly back off.
    if(!(radio_status & RADIO_STATUS_DISCOVERING) && packet_received_count != tx_received_count)
    {
        console.log("tx cb BACK_OFF");
        tx_received_count = packet_received_count;
        PeridoRadio.instance.timer.setCompare(CHECK_TX_CHANNEL, PeridoRadio.instance.timer.captureCounter(CHECK_TX_CHANNEL) + TX_BACKOFF_MIN + microbit_random(TX_BACKOFF_TIME));
    }
}

function go_to_sleep()
{
    // we have reached the end of the period with no response, come back in another PERIOD useconds.
    if(radio_status & RADIO_STATUS_DISCOVERING)
    {
        console.log("SLEEP D");
        // PeridoRadio.instance.timer.setCompare(CHECK_TX_CHANNEL, PeridoRadio.instance.timer.captureCounter(CHECK_TX_CHANNEL) +  DISCOVERY_TX_BACKOFF_TIME + microbit_random(DISCOVERY_TX_BACKOFF_TIME));
        PeridoRadio.instance.timer.setCompare(GO_TO_SLEEP_CHANNEL, PeridoRadio.instance.timer.captureCounter(GO_TO_SLEEP_CHANNEL) + DISCOVERY_BACKOFF_TIME);
        return;
    }

    if (packet_received_count == sleep_received_count && !(radio_status & (RADIO_STATUS_RECEIVING | RADIO_STATUS_TRANSMIT)))
    {
        console.log("SLEEP RTS");
        // if not seen a packet since the last time, aren't in a weird mode, and have a next wake up time, then go to sleep
        if(radio_status & RADIO_STATUS_WAKE_CONFIGURED)
        {
            console.log("SLEEP wAkE");
            radio_status = RADIO_STATUS_DISABLE | RADIO_STATUS_SLEEPING;
            radio_state_machine();
            return;
        }

        // if no next wake configured, not in discovery mode, and we have a previous period, then set wakeup for the previous period
        if (!(radio_status & (RADIO_STATUS_WAKE_CONFIGURED | RADIO_STATUS_DISCOVERING)) && previous_period > 0)
        {
            console.log("prev period set");
            radio_status |= RADIO_STATUS_WAKE_CONFIGURED | RADIO_STATUS_SLEEPING;
        PeridoRadio.instance.timer.setCompare(WAKE_UP_CHANNEL, PeridoRadio.instance.timer.captureCounter(WAKE_UP_CHANNEL) + (previous_period /** 1000*/));
            return;
        }
    }
    else
    {
         // else, remain in FORWARD mode, and schedule a wake up come back in another SLEEP_BACKOFF_TIME us
        sleep_received_count = packet_received_count;
        PeridoRadio.instance.timer.setCompare(GO_TO_SLEEP_CHANNEL, PeridoRadio.instance.timer.captureCounter(GO_TO_SLEEP_CHANNEL) + SLEEP_BACKOFF_TIME);
    }
}

function wake_up()
{
    radio_status &= ~(RADIO_STATUS_SLEEPING | RADIO_STATUS_WAKE_CONFIGURED);
    radio_status |=  RADIO_STATUS_RX_EN;

    if (radio_status & RADIO_STATUS_DISCOVERING)
    {
        // radio_status |= RADIO_STATUS_FORWARD;
        PeridoRadio.instance.timer.setCompare(CHECK_TX_CHANNEL, PeridoRadio.instance.timer.captureCounter(CHECK_TX_CHANNEL) + DISCOVERY_TX_BACKOFF_TIME + microbit_random(DISCOVERY_TX_BACKOFF_TIME));
        PeridoRadio.instance.timer.setCompare(GO_TO_SLEEP_CHANNEL, PeridoRadio.instance.timer.captureCounter(GO_TO_SLEEP_CHANNEL) + DISCOVERY_BACKOFF_TIME);
    }
    else
    {
        let tx_backoff = TX_BACKOFF_MIN +  microbit_random(TX_BACKOFF_TIME);
        PeridoRadio.instance.timer.setCompare(CHECK_TX_CHANNEL, PeridoRadio.instance.timer.captureCounter(CHECK_TX_CHANNEL) + tx_backoff);
        PeridoRadio.instance.timer.setCompare(GO_TO_SLEEP_CHANNEL, PeridoRadio.instance.timer.captureCounter(GO_TO_SLEEP_CHANNEL) + (tx_backoff + microbit_random(SLEEP_BACKOFF_TIME)));
    }

    radio_state_machine();
}

function timer_callback(channel_num: number)
{
    console.log("TIMER ", channel_num);

    if(channel_num == WAKE_UP_CHANNEL)
        wake_up();

    if (channel_num == CHECK_TX_CHANNEL)
        tx_callback();

    if (channel_num == STATE_MACHINE_CHANNEL)
        radio_state_machine();

    if (channel_num == GO_TO_SLEEP_CHANNEL)
        go_to_sleep();
}

class PeridoRadio
{
    static instance: PeridoRadio;

    timer: PeridoTimer;
    radio: Radio;

    txQueue: PeridoFrameBuffer[];
    rxQueue: PeridoFrameBuffer[];

    rxBuf: PeridoFrameBuffer;

    appId: number;
    namespaceId: number;

    constructor(r: Radio, appId: number, namespaceId: number)
    {
        if (PeridoRadio.instance)
            return PeridoRadio.instance;

        this.radio = r;
        this.timer = new PeridoTimer();
        this.timer.setFunction(timer_callback);

        this.txQueue = []
        this.rxQueue = []
        this.rxBuf = new PeridoFrameBuffer();

        this.appId = appId;
        this.namespaceId = namespaceId;

        PeridoRadio.instance = this;
    }

    enable()
    {
        this.radio.enable_interrupt("END", radio_IRQ);
        radio_status = RADIO_STATUS_DISABLED | RADIO_STATUS_DISCOVERING;
        this.timer.setCompare(WAKE_UP_CHANNEL,600);
    }

    queueRxBuf()
    {
        this.rxQueue.push(this.rxBuf);
        this.rxBuf = new PeridoFrameBuffer();
    }

    popTxQueue()
    {
        this.txQueue.shift();
    }

    send(data: any)
    {
        let buf: PeridoFrameBuffer = new PeridoFrameBuffer();

        buf.length = data.length;
        buf.app_id = this.appId;
        buf.namespace_id = this.namespaceId;
        buf.ttl = 4;
        buf.sleep_period_ms = 10000;//getPeriod();
        buf.id = microbit_random(0x7FFFFFFF);
        buf.payload = data;

        this.txQueue.push(buf);
    }
}

export {PeridoRadio};