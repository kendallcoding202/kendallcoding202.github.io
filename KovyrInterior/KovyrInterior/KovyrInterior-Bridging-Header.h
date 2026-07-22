// BSD networking bridging for Swift. `sockaddr_dl` / `inet_ntop` come from the
// public SDK headers below; `net/route.h` is NOT shipped in the iOS SDK, so we
// declare the minimal route-message header + constant ARPTable needs to parse the
// ARP cache returned by sysctl(NET_RT_FLAGS). Declaring the struct in C lets the
// compiler compute the correct ABI layout/padding for us.
#import <sys/types.h>
#import <sys/socket.h>
#import <sys/sysctl.h>
#import <net/if.h>
#import <net/if_dl.h>
#import <netinet/in.h>
#import <arpa/inet.h>

#ifndef NET_RT_FLAGS
#define NET_RT_FLAGS 2
#endif

struct kovyr_rt_metrics {
    u_int32_t rmx_locks;
    u_int32_t rmx_mtu;
    u_int32_t rmx_hopcount;
    int32_t   rmx_expire;
    u_int32_t rmx_recvpipe;
    u_int32_t rmx_sendpipe;
    u_int32_t rmx_ssthresh;
    u_int32_t rmx_rtt;
    u_int32_t rmx_rttvar;
    u_int32_t rmx_pksent;
    u_int32_t rmx_state;
    u_int32_t rmx_filler[3];
};

struct kovyr_rt_msghdr {
    u_short   rtm_msglen;
    u_char    rtm_version;
    u_char    rtm_type;
    u_short   rtm_index;
    int       rtm_flags;
    int       rtm_addrs;
    pid_t     rtm_pid;
    int       rtm_seq;
    int       rtm_errno;
    int       rtm_use;
    u_int32_t rtm_inits;
    struct kovyr_rt_metrics rtm_rmx;
};
