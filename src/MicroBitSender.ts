import {Radio} from "./Radio"
import {PeridoRadio} from "./PeridoRadio"

let r = new Radio();
let pr = new PeridoRadio(r, 0x123456, 0x789123);
let str = "abc123";

pr.enable();

function sendPacket()
{
    pr.send("ABC123");
}

setInterval(sendPacket, 10000 + (Math.random() * 20000));