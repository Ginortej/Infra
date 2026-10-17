package vault

// Server — один файл в servers/*.yaml.
type Server struct {
	ID    string   `yaml:"-" json:"id"`
	File  string   `yaml:"-" json:"file"`
	Name  string   `yaml:"name" json:"name"`
	Host  string   `yaml:"host" json:"host"`
	Port  int      `yaml:"port,omitempty" json:"port"`
	User  string   `yaml:"user" json:"user"`
	Auth  string   `yaml:"auth,omitempty" json:"auth"` // key | password
	Key   string   `yaml:"key,omitempty" json:"key"`   // путь к приватному ключу
	VPN   string   `yaml:"via_vpn,omitempty" json:"vpn"`
	Group string   `yaml:"group,omitempty" json:"group"`
	Tags  []string `yaml:"tags,omitempty" json:"tags"`
	Jump  string   `yaml:"jump,omitempty" json:"jump"` // id другого сервера
	Lab   string   `yaml:"lab,omitempty" json:"lab"`
}

// VPNProfile — файл в vpn/*.yaml.
type VPNProfile struct {
	ID        string         `yaml:"-" json:"id"`
	File      string         `yaml:"-" json:"file"`
	Name      string         `yaml:"name" json:"name"`
	Type      string         `yaml:"type" json:"type"` // wireguard | singbox | socks
	Socks     int            `yaml:"socks" json:"socks"`
	Autostart bool           `yaml:"autostart,omitempty" json:"autostart"`
	WireGuard string         `yaml:"wireguard,omitempty" json:"wireguard"` // путь к .conf
	Outbound  map[string]any `yaml:"outbound,omitempty" json:"-"`          // сырой outbound sing-box
	Proxy     string         `yaml:"proxy,omitempty" json:"proxy"`         // для type: socks — внешний прокси host:port
}

// Lab — файл в labs/*.yaml.
type Lab struct {
	ID        string       `yaml:"-" json:"id"`
	File      string       `yaml:"-" json:"file"`
	Name      string       `yaml:"lab" json:"name"`
	Provider  string       `yaml:"provider" json:"provider"` // virtualbox | vmware
	Template  string       `yaml:"template" json:"template"`
	Snapshot  string       `yaml:"snapshot,omitempty" json:"snapshot"`
	User      string       `yaml:"user" json:"user"`
	SSHKey    string       `yaml:"ssh_key" json:"sshKey"`
	Network   LabNetwork   `yaml:"network" json:"network"`
	Machines  []LabMachine `yaml:"machines" json:"machines"`
	Provision struct {
		Playbook string `yaml:"playbook" json:"playbook"`
	} `yaml:"provision" json:"provision"`
}

type LabNetwork struct {
	CIDR     string   `yaml:"cidr" json:"cidr"`
	Gateway  string   `yaml:"gateway,omitempty" json:"gateway"`
	DNS      []string `yaml:"dns,omitempty" json:"dns"`
	HostOnly string   `yaml:"hostonly,omitempty" json:"hostonly"` // VirtualBox: имя host-only адаптера
	VMnet    string   `yaml:"vmnet,omitempty" json:"vmnet"`       // VMware: vmnet1 / vmnet8 / ...
}

type LabMachine struct {
	Name    string `yaml:"name" json:"name"`
	Count   int    `yaml:"count,omitempty" json:"count"`
	CPU     int    `yaml:"cpu" json:"cpu"`
	RAM     int    `yaml:"ram" json:"ram"`
	IP      string `yaml:"ip,omitempty" json:"ip"`
	IPStart string `yaml:"ip_start,omitempty" json:"ipStart"`
}

// Script — файл из scripts/.
type Script struct {
	Path string `json:"path"` // относительный путь
	Kind string `json:"kind"` // bash | ansible | powershell | cmd
}

// Snapshot — всё содержимое хранилища для интерфейса.
type Snapshot struct {
	Path    string       `json:"path"`
	Name    string       `json:"name"`
	Servers []Server     `json:"servers"`
	VPNs    []VPNProfile `json:"vpns"`
	Labs    []Lab        `json:"labs"`
	Scripts []Script     `json:"scripts"`
	Tree    []string     `json:"tree"`
	Errors  []string     `json:"errors"`
}
