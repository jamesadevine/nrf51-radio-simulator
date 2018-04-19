import sched, time

from multiprocessing.dummy import Pool


pool = Pool(processes=4)

radio_states = [
    {
        "name":"DISABLED",
        "previous_actions":["DISABLED"],
        "next_actions":[{ "action": "TX_EN", "new_state":"TXRU"},{ "action": "RX_EN", "new_state":"RXRU"}]
    },
    {
        "name":"RXRU",
        "previous_actions":["RX_EN"],
        "next_actions":[{ "action": "DISABLE", "new_state":"RXDISABLE"}, { "action": "READY", "new_state":"RXIDLE"}],
        "trigger_action":[{"action":"READY", "time":10}]
    },
    {
        "name":"RXIDLE",
        "previous_actions":["READY", "RX_END", "RX_STOP"],
        "next_actions":[ { "action": "DISABLE", "new_state":"RXDISABLE"}, {"action":"START", "new_state":"RX"}]
    },
    {
        "name":"RX",
        "previous_actions":["RX_START", "RX_ADDRESS", "RX_PAYLOAD"],
        "next_actions":[{ "action": "DISABLE", "new_state":"RXDISABLE"},{ "action": "END", "new_state":"RXIDLE"},{ "action": "RX_STOP", "new_state":"RXIDLE"},{ "action": "ADDRESS", "new_state":"RX"},{ "action": "PAYLOAD", "new_state":"RX"}]
    },
    {
        "name":"RXDISABLE",
        "previous_actions":["DISABLE"],
        "next_actions":[{ "action": "DISABLED", "new_state":"DISABLED"}]
    },
    {
        "name":"TXRU",
        "previous_actions":["TX_EN"],
        "next_actions":[{ "action": "DISABLE", "new_state":"TXDISABLE"},{ "action": "READY", "new_state":"TXIDLE"}],
        "trigger_action":[{"action":"READY", "time":10}]
    },
    {
        "name":"TXIDLE",
        "previous_actions":["READY","END","STOP"],
        "next_actions":[{ "action": "DISABLE", "new_state":"TXDISABLE"}, {"action":"START", "new_state":"TX"}]
    },
    {
        "name":"TX",
        "previous_actions":["TX_START", "TX_ADDRESS", "TX_PAYLOAD"],
        "next_actions":[{ "action": "DISABLE", "new_state":"TXDISABLE"},{ "action": "END", "new_state":"TXIDLE"},{ "action": "STOP", "new_state":"TXIDLE"},{ "action": "ADDRESS", "new_state":"TX"}, { "action": "PAYLOAD", "new_state":"TX"}]
    },
    {
        "name":"TXDISABLE",
        "previous_actions":["DISABLE"],
        "next_actions":[{ "action": "DISABLED", "new_state":"DISABLED"}]
    }
]

class Radio:

    s = sched.scheduler(time.time, time.sleep)

    current_state = radio_states[0]
    events_enable =0
    events_end = 0
    events_address = 0
    events_disable = 0

    trigger_end = 0
    trigger_address = 0

    def schedule_state_update(self, value, time):
        self.s.enter(time, 1,self.update_state,[value])
        self.s.run()

    def interrupt():
        print "interrupt"

    def update_state(self, action):
        next_action = action

        if action == "END" and trigger_end == 1:
            self.interrupt()
        if action == "ADDRESS" and trigger_address == 1:
            self.interrupt()

        valid_next_action = "NONE"
        valid_next_state = {}
        for valid_action in self.current_state["next_actions"]:
            print valid_action
            print action
            if next_action == valid_action["action"]:
                valid_next_action = next_action
                for state in radio_states:
                    if state["name"] == valid_action["new_state"]:
                        valid_next_state = state

        # indicates next action invalid, or next state doesn't exist
        if valid_next_action == "NONE" or valid_next_state == {}:
            raise Exception("invalid next state")

        self.current_state = valid_next_state

        if "trigger_action" in self.current_state.keys():
            self.schedule_state_update(self.current_state["trigger_action"][0]["action"], self.current_state["trigger_action"][0]["time"])

    def get_state(self):
        return self.current_state

    def EVENTS_ENABLE(self, value=-1):
        if value == -1:
            return self.events_enable

        events_enable = value

    def EVENTS_END(self, value=-1):
        if value == -1:
            return self.events_end

        events_end = value

    def EVENTS_ADDRESS(self, value=-1):
        if value == -1:
            return self.events_address

        events_address = value

    def EVENTS_DISABLED(self, value=-1):
        if value == -1:
            return self.events_disabled

        events_disabled = value

    def TASKS_TXEN(self, value):
        if value > 0:
            self.update_state("TX_EN")

    def TASKS_RXEN(self, value):
        if value > 0:
            self.update_state("RX_EN")

    def TASKS_DISABLE(self, value):
        if value > 0:
            self.update_state("DISABLE")

    def TASKS_START(self, value):
        if value > 0:
            self.update_state("START")



r = Radio()

r.TASKS_TXEN(1)
r.TASKS_START(1)

while True:
    a = 1