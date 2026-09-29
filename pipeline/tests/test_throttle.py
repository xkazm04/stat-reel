from statreel_ingest.throttle import HostThrottle


def test_first_request_does_not_wait(clock):
    t = HostThrottle(clock=clock, sleep=clock.sleep)
    t.wait("api.github.com", 120.0)
    assert clock.slept == []


def test_second_request_waits_out_the_interval(clock):
    t = HostThrottle(clock=clock, sleep=clock.sleep)
    t.wait("api.github.com", 120.0)
    clock.now += 20
    t.wait("api.github.com", 120.0)
    assert clock.slept == [100.0]


def test_hosts_are_throttled_independently(clock):
    t = HostThrottle(clock=clock, sleep=clock.sleep)
    t.wait("a.example", 10.0)
    t.wait("b.example", 10.0)
    assert clock.slept == []


def test_elapsed_interval_needs_no_wait(clock):
    t = HostThrottle(clock=clock, sleep=clock.sleep)
    t.wait("a.example", 3.0)
    clock.now += 5
    t.wait("a.example", 3.0)
    assert clock.slept == []
