import {Radio} from "./Radio"

const BREAK_POINT_ENABLE = 1;

function breakpoint(str: string)
{
    if (!BREAK_POINT_ENABLE)
        return;

    console.log("BREAKPOINT ", str, "\r\n", new Error().stack);
    debug_radio_state();

    while(1);
}

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
const RADIO_STATUS_EXPECT_RESPONSE = 0x01000000

const NO_RESPONSE_THRESHOLD = 3;
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
    {"bitmsk": RADIO_STATUS_EXPECT_RESPONSE,"text":"EXPECT RESPONSE"},
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

const SLEEP_BACKOFF_TIME = 500
const TX_BACKOFF_MIN = 100
const TX_BACKOFF_TIME = (1000 - TX_BACKOFF_MIN)
const TX_TIME = 300         // includes tx time for a larger packet
const TX_ENABLE_TIME = 300         // includes processing time overhead on reception for other nodes...
const RX_ENABLE_TIME = 200
const RX_TX_DISABLE_TIME = 60          // 10 us is pretty pointless for a timer callback.

const FORWARD_POLL_TIME = 200;
const ABSOLUTE_RESPONSE_TIME = 600;
const PERIDO_DEFAULT_PERIOD = 6000;

const WAKE_UP_CHANNEL = 0
const GO_TO_SLEEP_CHANNEL = 1
const CHECK_TX_CHANNEL = 2
const STATE_MACHINE_CHANNEL = 3

let channel_arr: string[] = ["WAKE_UP", "GO_TO_SLEEP", "CHECK_TX_CHANNEL","STATE_MACHINE_CHANNEL"];

var radio_status: number = 0;
var previous_period: number = 0;

var packet_received_count: number = 0;
var sleep_received_count: number = 0;
var no_response_count: number = 0;
// var tx_received_count: number = 0;

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
    channel_count: number;
    channels:number[];
    count: number;
    cb: (channel_num:number) => void

    constructor(channel_count: number)
    {
        this.channel_count = channel_count
        this.cb = null;
        this.count = 0;

        this.channels = [];

        for(let i = 0; i < channel_count; i++)
        {
            this.channels.push(null);
        }

        setInterval(this.incrementCount, 1);
    }

    setFunction(cb: (channel_num:number) => void)
    {
        this.cb = cb;
    }

    wrapperFunction= (channel_num:number)=>
    {
        this.channels[channel_num] = null;
        this.cb(channel_num);
    }

    setCompare(channel: number, sleepPeriod: Number)
    {
        if(this.channels[channel] != null)
            clearTimeout(this.channels[channel]);

        let id = setTimeout(this.wrapperFunction, sleepPeriod, channel);
        this.channels[channel] = id;
    }

    captureCounter(number: number)
    captureCounter()
    {
        return 0;
        //return this.count;
    }

    sysTime()
    {
        return this.count;
    }

    incrementCount = () =>
    {
        this.count++;
    }
}

var last_time = 0

function debug_radio_state()
{
    var low_level = []
    var high_level = []
    let sysTime = PeridoRadio.instance.timer.sysTime();
    for (let rs of radio_status_array)
    {
        if(rs.bitmsk & LOW_LEVEL_STATE_MASK && radio_status & rs.bitmsk)
            low_level.push(rs.text);

        if(rs.bitmsk & HIGH_LEVEL_STATE_MASK && radio_status & rs.bitmsk)
            high_level.push(rs.text);
    }




    console.log("-----------------------");
    console.log("\r|Low\t| ",low_level.join("\t|"));
    console.log("\r|High\t| ",high_level.join("\t|"));
    console.log("|RQ\t| ",PeridoRadio.instance.rxQueue.length);
    console.log("|TQ\t| ",PeridoRadio.instance.txQueue.length);
    console.log("|Time\t|", sysTime - last_time)
    console.log("|NRes\t|", no_response_count)
    console.log("-----------------------");
    last_time = sysTime;
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
            PeridoRadio.instance.radio.EVENTS_ADDRESS(0);
            radio_status |= RADIO_STATUS_RECEIVING;
            return;
        }

        if(PeridoRadio.instance.radio.EVENTS_END())
        {

            console.log("RX END");
            radio_status &= ~(RADIO_STATUS_RECEIVING);

            packet_received_count++;
            sleep_received_count = packet_received_count;
            PeridoRadio.instance.timer.setCompare(GO_TO_SLEEP_CHANNEL, PeridoRadio.instance.timer.captureCounter(GO_TO_SLEEP_CHANNEL) + FORWARD_POLL_TIME + 500);


            PeridoRadio.instance.radio.EVENTS_END(0);
            PeridoRadio.instance.radio.TASKS_START(1);

            if(PeridoRadio.instance.radio.CRCSTATUS() == 1)
            {
                let p: PeridoFrameBuffer = PeridoRadio.instance.rxBuf || null;
                console.log(p);

                if (p)
                {
                    previous_period = p.sleep_period_ms;

                    if(p.ttl > 0)
                    {
                        p.ttl--;
                        radio_status &= ~RADIO_STATUS_RX_RDY;
                        radio_status |= (RADIO_STATUS_FORWARD | RADIO_STATUS_DISABLE | RADIO_STATUS_TX_EN);
                    }
                    else
                    {
                        // breakpoint("FUUUU");
                        radio_status &= ~RADIO_STATUS_FORWARD;
                        PeridoRadio.instance.timer.setCompare(CHECK_TX_CHANNEL, PeridoRadio.instance.timer.captureCounter(CHECK_TX_CHANNEL) + TX_BACKOFF_MIN + microbit_random(TX_BACKOFF_TIME));
                        radio_status |= RADIO_STATUS_STORE;
                    }
                }
            }
            else
            {
                // add last packet to worry queue
            }

            radio_status &= ~(RADIO_STATUS_EXPECT_RESPONSE | RADIO_STATUS_DISCOVERING);
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

            radio_status |= (RADIO_STATUS_FORWARD | RADIO_STATUS_DISABLE | RADIO_STATUS_RX_EN | RADIO_STATUS_EXPECT_RESPONSE);

            PeridoRadio.instance.timer.setCompare(GO_TO_SLEEP_CHANNEL, PeridoRadio.instance.timer.captureCounter(GO_TO_SLEEP_CHANNEL) + FORWARD_POLL_TIME);

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

        if(radio_status & RADIO_STATUS_TX_END)
        {
            console.log("F TX END")
            radio_status &= ~RADIO_STATUS_TX_END;
            radio_status |= RADIO_STATUS_DISABLE | RADIO_STATUS_RX_EN;

            PeridoRadio.instance.timer.setCompare(GO_TO_SLEEP_CHANNEL, PeridoRadio.instance.timer.captureCounter(GO_TO_SLEEP_CHANNEL) + FORWARD_POLL_TIME + 500);

            PeridoRadio.instance.radio.EVENTS_END(0);
        }

        if(radio_status & RADIO_STATUS_TX_RDY)
        {
            console.log("F TX RDY")
            radio_status &= ~RADIO_STATUS_TX_RDY;
            radio_status |= RADIO_STATUS_TX_END;

            PeridoRadio.instance.radio.PACKETPTR(PeridoRadio.instance.rxBuf);

            PeridoRadio.instance.radio.TASKS_START(1);
            PeridoRadio.instance.radio.EVENTS_END(0);

            radio_status |= RADIO_STATUS_STORE;
        }

    }

    if(radio_status & RADIO_STATUS_STORE)
    {
        console.log("store")
        radio_status &= ~RADIO_STATUS_STORE;

        let p: PeridoFrameBuffer = PeridoRadio.instance.rxBuf;
        let tx: PeridoFrameBuffer = PeridoRadio.instance.txQueue[0] || null;

        let seen = false;

        if(tx != null && PeridoRadio.instance.rxBuf.id == tx.id && PeridoRadio.instance.rxBuf.ttl < tx.ttl)
        {
            // only pop our tx buffer and set our period if something responds
            previous_period = PeridoRadio.instance.rxBuf.sleep_period_ms;
            PeridoRadio.instance.popTxQueue();

            seen =true

            last_seen[last_seen_index] = p.id;
            last_seen_index = (last_seen_index + 1) %  LAST_SEEN_BUFFER_SIZE;

        }

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

        radio_status = (radio_status & (HIGH_LEVEL_STATE_MASK | RADIO_STATUS_RX_EN | RADIO_STATUS_TX_EN)) | RADIO_STATUS_DISABLED;

        PeridoRadio.instance.timer.setCompare(STATE_MACHINE_CHANNEL, PeridoRadio.instance.timer.captureCounter(STATE_MACHINE_CHANNEL) + RX_TX_DISABLE_TIME);
        return;
    }
}

function radio_IRQ(event:string)
{
    console.log("IRQ: ",event);
    radio_state_machine();
}

function tx_callback()
{
    console.log("tx callback");
    // nothing to do if sleeping
    if(radio_status & RADIO_STATUS_SLEEPING)
        return;

    // no one else has transmitted recently, and we are not receiving, we can transmit
    if(PeridoRadio.instance.txQueue.length > 0 && !(radio_status & (RADIO_STATUS_RECEIVING | RADIO_STATUS_FORWARD)))
    {
        console.log("tx cb TX");
        radio_status = (radio_status & RADIO_STATUS_DISCOVERING) | RADIO_STATUS_TRANSMIT | RADIO_STATUS_DISABLE | RADIO_STATUS_TX_EN;
        radio_state_machine();
        return;
    }

    // otherwise randomly back off.
    console.log("tx cb BACK_OFF");
    debug_radio_state();
    PeridoRadio.instance.timer.setCompare(CHECK_TX_CHANNEL, PeridoRadio.instance.timer.captureCounter(CHECK_TX_CHANNEL) + microbit_random(TX_BACKOFF_TIME));
}

function go_to_sleep()
{
    // nothing has changed, and nothing is about to change.
    if (!(radio_status & (RADIO_STATUS_RECEIVING | RADIO_STATUS_TRANSMIT)) && packet_received_count == sleep_received_count)
    {

        if (radio_status & RADIO_STATUS_EXPECT_RESPONSE)
        {
            no_response_count++
            radio_status &= ~RADIO_STATUS_EXPECT_RESPONSE;
        }

        sleep_received_count = packet_received_count;
        radio_status &= ~RADIO_STATUS_FORWARD;
        radio_status |= RADIO_STATUS_WAKE_CONFIGURED | RADIO_STATUS_SLEEPING | RADIO_STATUS_DISABLE;
        let period = (previous_period > 0) ? previous_period : PERIDO_DEFAULT_PERIOD;
        console.log("SETTING PERIOD ",period);
        PeridoRadio.instance.timer.setCompare(WAKE_UP_CHANNEL, PeridoRadio.instance.timer.captureCounter(WAKE_UP_CHANNEL) + (period /** 1000*/));
        radio_state_machine();
    }
}

function wake_up()
{
    radio_status &= ~(RADIO_STATUS_SLEEPING | RADIO_STATUS_WAKE_CONFIGURED);
    radio_status |=  RADIO_STATUS_RX_EN;

    if (no_response_count > NO_RESPONSE_THRESHOLD)
    {
        radio_status |= RADIO_STATUS_DISCOVERING;
        no_response_count = 0;
        // breakpoint("NO RESPONSE");
    }

    if (radio_status & RADIO_STATUS_DISCOVERING)
    {
        PeridoRadio.instance.timer.setCompare(CHECK_TX_CHANNEL, PeridoRadio.instance.timer.captureCounter(CHECK_TX_CHANNEL) + DISCOVERY_TX_BACKOFF_TIME + microbit_random(DISCOVERY_TX_BACKOFF_TIME));
    }
    else
    {
        // as the queue grows, decrease back off time
        let len = (PeridoRadio.instance.txQueue.length > 0) ? PeridoRadio.instance.txQueue.length : 1;
        let tx_backoff = (TX_BACKOFF_MIN / len) +  microbit_random(TX_BACKOFF_TIME);
        PeridoRadio.instance.timer.setCompare(CHECK_TX_CHANNEL, PeridoRadio.instance.timer.captureCounter(CHECK_TX_CHANNEL) + tx_backoff);
        PeridoRadio.instance.timer.setCompare(GO_TO_SLEEP_CHANNEL, PeridoRadio.instance.timer.captureCounter(GO_TO_SLEEP_CHANNEL) + ABSOLUTE_RESPONSE_TIME);
    }

    radio_state_machine();
}

function timer_callback(channel_num: number)
{
    console.log(channel_arr[channel_num], " TIMER");

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
        this.timer = new PeridoTimer(4);
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
        this.radio.enable_interrupt("ADDRESS", radio_IRQ);
        radio_status = RADIO_STATUS_DISABLED | RADIO_STATUS_DISCOVERING;
        this.timer.setCompare(WAKE_UP_CHANNEL,600);
    }

    queueRxBuf()
    {
        this.rxQueue.push(this.rxBuf);
        // this.rxBuf = new PeridoFrameBuffer();
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