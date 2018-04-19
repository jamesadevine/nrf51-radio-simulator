import {Radio} from "./Radio"
import {PeridoRadio} from "./PeridoRadio"

let r = new Radio();
let pr = new PeridoRadio(r, 0x123456, 0x789123);

pr.enable();